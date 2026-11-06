/** 얼굴 가리기: 모자이크 또는 귀여운 스티커. 사진 크기는 바꾸지 않는다. */
import sharp from "sharp";
import type { FaceMode } from "../config/schema";
import type { FaceBox } from "./faces";

export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 얼굴 상자를 여유(padding) 비율만큼 넓히고 사진 안으로 자른다. 좌표는 정수. */
export function expandBox(box: FaceBox, padding: number, imgW: number, imgH: number): Region | undefined {
  const padX = box.width * padding;
  const padY = box.height * padding;
  const left = Math.max(0, Math.floor(box.x - padX));
  const top = Math.max(0, Math.floor(box.y - padY));
  const right = Math.min(imgW, Math.ceil(box.x + box.width + padX));
  const bottom = Math.min(imgH, Math.ceil(box.y + box.height + padY));
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) return undefined;
  return { left, top, width, height };
}

/** 좌표를 다른 크기의 사진에 맞게 바꾼다(작은 사본에서 찾은 얼굴을 큰 사진에 적용할 때). */
export function scaleBox(box: FaceBox, factor: number): FaceBox {
  return { x: box.x * factor, y: box.y * factor, width: box.width * factor, height: box.height * factor, score: box.score };
}

const STICKER_SCALE = 0.9;

/** 원형 스티커(웃는 얼굴). 외부 이미지 없이 SVG로 그린다. */
function stickerSvg(size: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="48" fill="#FFD43B" stroke="#F59F00" stroke-width="3"/>
  <ellipse cx="34" cy="42" rx="6" ry="8" fill="#3B2F2F"/>
  <ellipse cx="66" cy="42" rx="6" ry="8" fill="#3B2F2F"/>
  <circle cx="36" cy="39" r="2" fill="#fff"/><circle cx="68" cy="39" r="2" fill="#fff"/>
  <ellipse cx="24" cy="60" rx="8" ry="5" fill="#FF8FAB" opacity="0.8"/>
  <ellipse cx="76" cy="60" rx="8" ry="5" fill="#FF8FAB" opacity="0.8"/>
  <path d="M36 62 Q50 76 64 62" fill="none" stroke="#3B2F2F" stroke-width="4" stroke-linecap="round"/>
</svg>`);
}

/** 얼굴 영역을 아주 작게 줄였다가 다시 키워 블록 모자이크를 만든다. sharp는 한 파이프라인에서 resize를 한 번만 적용하므로 두 단계로 나눈다. */
async function mosaicPatch(img: Buffer, r: Region, cells: number): Promise<Buffer> {
  const cols = Math.max(2, cells);
  const rows = Math.max(2, Math.round(cols * (r.height / r.width)));
  const tiny = await sharp(img).extract(r).resize(cols, rows, { fit: "fill", kernel: "cubic" }).png().toBuffer();
  return sharp(tiny).resize(r.width, r.height, { fit: "fill", kernel: "nearest" }).png().toBuffer();
}

/**
 * 사진 버퍼에 얼굴 가리기를 적용한다. 입력은 회전이 이미 반영된(EXIF 없는) 이미지여야 한다.
 * 얼굴이 없거나 mode가 none이면 입력을 그대로 돌려준다.
 */
export async function applyFaceMask(
  img: Buffer,
  boxes: FaceBox[],
  mode: FaceMode,
  opts: { padding: number; mosaicCells: number },
): Promise<Buffer> {
  if (mode === "none" || boxes.length === 0) return img;
  const meta = await sharp(img).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const regions = boxes.map((b) => expandBox(b, opts.padding, w, h)).filter((r): r is Region => !!r);
  if (regions.length === 0) return img;

  const overlays = await Promise.all(
    regions.map(async (r) => {
      if (mode === "mosaic") return { input: await mosaicPatch(img, r, opts.mosaicCells), left: r.left, top: r.top };
      // 검출 상자는 이미 머리 전체를 감싸므로 스티커는 상자보다 약간 작게 둔다
      const size = Math.max(8, Math.round(Math.max(r.width, r.height) * STICKER_SCALE));
      const left = Math.max(0, Math.min(w - size, Math.round(r.left + r.width / 2 - size / 2)));
      const top = Math.max(0, Math.min(h - size, Math.round(r.top + r.height / 2 - size / 2)));
      const fit = Math.min(size, w, h);
      return { input: await sharp(stickerSvg(fit)).png().toBuffer(), left, top };
    }),
  );
  return sharp(img).composite(overlays).toBuffer();
}
