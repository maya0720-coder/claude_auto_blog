import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Defaults } from "../config/schema";

export class InvalidImageError extends Error {
  override name = "InvalidImageError";
}

/** 업로드할 사진 경로 목록을 검사한다: 개수, 확장자, 크기, 일반 파일 여부. */
export function validateImagePaths(paths: string[], cfg: Defaults["images"], maxCount: number): string[] {
  if (paths.length === 0) throw new InvalidImageError("사진을 1장 이상 지정해 주세요.");
  if (paths.length > maxCount) throw new InvalidImageError(`사진은 최대 ${maxCount}장까지 지정할 수 있습니다.`);
  return paths.map((p, i) => {
    const abs = path.resolve(p);
    const ext = path.extname(abs).toLowerCase();
    if (!cfg.allowedExtensions.includes(ext)) {
      throw new InvalidImageError(`사진 ${i + 1}: 지원하지 않는 형식입니다 (${cfg.allowedExtensions.join(", ")}).`);
    }
    let size: number;
    try {
      const st = statSync(abs);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch {
      throw new InvalidImageError(`사진 ${i + 1}: 파일을 찾을 수 없습니다.`);
    }
    if (size === 0 || size > cfg.maxBytes) {
      throw new InvalidImageError(`사진 ${i + 1}: 파일 크기가 0이거나 제한(${cfg.maxBytes}바이트)을 넘습니다.`);
    }
    return abs;
  });
}

/**
 * 네이버 업로드용 사본을 만든다(설계서 A4).
 * sharp는 다시 인코딩할 때 EXIF(GPS 포함)를 기본으로 버린다. 회전 정보는 먼저 픽셀에 반영한다.
 * 원본은 수정하지 않는다.
 */
export async function makeUploadCopies(
  paths: string[],
  outDir: string,
  stripMetadata: boolean,
): Promise<string[]> {
  if (!stripMetadata) return paths;
  mkdirSync(outDir, { recursive: true });
  const out: string[] = [];
  for (const [i, src] of paths.entries()) {
    const dest = path.join(outDir, `upload-${String(i + 1).padStart(2, "0")}.jpg`);
    try {
      await sharp(src, { failOn: "error" }).rotate().jpeg({ quality: 92, mozjpeg: true }).toFile(dest);
    } catch {
      throw new InvalidImageError(`사진 ${i + 1}: 이미지를 읽을 수 없습니다.`);
    }
    out.push(dest);
  }
  return out;
}
