/**
 * 사진 준비: 회전 보정 → 촬영 시각 읽기 → AI용·업로드용 사본(EXIF·GPS 없음) → 얼굴 찾기 → 얼굴 가리기.
 * 얼굴은 AI용 작은 사본에서 찾고, 같은 상자를 크기에 맞춰 업로드용 사본에도 적용한다.
 * 원본은 수정하지 않는다. 외부로 보내는 것은 얼굴을 가린 AI용 사본뿐이다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import exifr from "exifr";
import sharp from "sharp";
import type { Defaults, FaceMode } from "../config/schema";
import type { JobStore } from "../jobs/store";
import type { Photo } from "../jobs/types";
import { FaceDetector, type FaceBox } from "./faces";
import { applyFaceMask, scaleBox } from "./mask";

async function readTakenAt(buf: Buffer): Promise<string | undefined> {
  try {
    const data = (await exifr.parse(buf, ["DateTimeOriginal", "CreateDate"])) as
      | { DateTimeOriginal?: Date; CreateDate?: Date }
      | undefined;
    const d = data?.DateTimeOriginal ?? data?.CreateDate;
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;
  } catch {
    return undefined; // EXIF가 없거나 읽을 수 없는 사진
  }
}

/** 긴 변을 maxEdge 이하로 줄인 JPEG. sharp는 메타데이터를 따로 지정하지 않으면 붙이지 않는다(EXIF·GPS 제거). */
function resized(buf: Buffer, maxEdge: number, quality: number) {
  return sharp(buf, { failOn: "error" })
    .rotate()
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
}

/**
 * 네이버 업로드용 사본: 긴 변을 줄이고, 본문 폭(minWidth)보다 좁은 사진은 폭을 키운다.
 * 작은 사진이 원래 크기로 왼쪽에 붙어 사진마다 크기가 달라 보이는 것을 막는다.
 */
export async function uploadCopy(buf: Buffer, maxEdge: number, minWidth: number, quality: number) {
  const up = await resized(buf, maxEdge, quality);
  if (!minWidth || up.info.width >= minWidth) return up;
  return sharp(up.data, { failOn: "error" })
    .resize({ width: minWidth, kernel: "lanczos3" })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
}

/** 저장된 얼굴 상자로 AI용·업로드용 사본을 다시 만든다(가리기 방식 변경 시에도 사용). */
export async function renderCopies(
  store: JobStore,
  jobId: string,
  photo: Photo,
  mode: FaceMode,
  cfg: Defaults,
): Promise<void> {
  const original = readFileSync(store.photoPath(jobId, photo, "original"));
  const opts = { padding: cfg.faces.boxPadding, mosaicCells: cfg.faces.mosaicCells };
  const ai = await resized(original, cfg.images.aiMaxEdge, cfg.images.jpegQuality);
  writeFileSync(store.photoPath(jobId, photo, "ai"), await applyFaceMask(ai.data, photo.faces, mode, opts));
  const up = await uploadCopy(original, cfg.images.uploadMaxEdge, cfg.images.uploadMinWidth, cfg.images.jpegQuality);
  const factor = up.info.width / photo.aiWidth;
  const boxes = photo.faces.map((b) => scaleBox(b, factor));
  writeFileSync(store.photoPath(jobId, photo, "upload"), await applyFaceMask(up.data, boxes, mode, opts));
}

/**
 * 모든 사진을 준비하고, 얼굴 상자·촬영 시각을 채운 사진 목록을 돌려준다.
 * 얼굴 인식이 실패하면 가리지 않은 사진이 외부로 나갈 수 있으므로 작업 전체를 실패시킨다.
 */
export async function preparePhotos(
  store: JobStore,
  jobId: string,
  photos: Photo[],
  mode: FaceMode,
  cfg: Defaults,
  onProgress: (done: number, total: number, faces: number) => void,
): Promise<Photo[]> {
  const detector = mode === "none" ? undefined : await FaceDetector.open(cfg.faces);
  const out: Photo[] = [];
  try {
    for (const [i, photo] of photos.entries()) {
      const original = readFileSync(store.photoPath(jobId, photo, "original"));
      const ai = await resized(original, cfg.images.aiMaxEdge, cfg.images.jpegQuality);
      const faces: FaceBox[] = detector ? await detector.detect(ai.data, "image/jpeg") : [];
      const takenAt = await readTakenAt(original);
      const next: Photo = { ...photo, faces, aiWidth: ai.info.width, ...(takenAt ? { takenAt } : {}) };
      await renderCopies(store, jobId, next, mode, cfg);
      out.push(next);
      onProgress(i + 1, photos.length, faces.length);
    }
  } finally {
    await detector?.close();
  }
  return out;
}

/** 촬영 시각 순으로 정렬한다. 시각이 없는 사진은 원래 순서를 유지한 채 뒤에 둔다. */
export function sortByTakenAt(photos: Photo[]): Photo[] {
  const withTime = photos.filter((p) => p.takenAt).sort((a, b) => a.takenAt!.localeCompare(b.takenAt!));
  return [...withTime, ...photos.filter((p) => !p.takenAt)];
}
