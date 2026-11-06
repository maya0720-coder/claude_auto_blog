/**
 * 얼굴 가리기 점검 도구(개발용): 사진을 넣으면 찾은 얼굴 수와 가린 결과를 data/debug/faces/에 저장한다.
 * 사용: npx tsx scripts/check-faces.ts <사진1> [사진2 ...]
 * 사진은 이 PC 안에서만 처리되고 외부로 전송되지 않는다.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { loadDefaults, resolveDataPath } from "../src/lib/config/load";
import { FACE_MODES } from "../src/lib/config/schema";
import { FaceDetector } from "../src/lib/images/faces";
import { applyFaceMask } from "../src/lib/images/mask";

async function main(files: string[]): Promise<number> {
  if (files.length === 0) {
    console.error("사용: npx tsx scripts/check-faces.ts <사진1> [사진2 ...]");
    return 2;
  }
  const cfg = loadDefaults();
  const outDir = resolveDataPath(path.join(cfg.output.debugDir, "faces"));
  mkdirSync(outDir, { recursive: true });
  const detector = await FaceDetector.open(cfg.faces);
  try {
    for (const [i, file] of files.entries()) {
      const img = await sharp(file).rotate().resize(cfg.images.aiMaxEdge, cfg.images.aiMaxEdge, { fit: "inside", withoutEnlargement: true }).jpeg().toBuffer();
      const started = Date.now();
      const boxes = await detector.detect(img, "image/jpeg");
      console.log(`사진 ${i + 1}: 얼굴 ${boxes.length}개 (${Date.now() - started}ms)`);
      for (const mode of FACE_MODES.filter((m) => m !== "none")) {
        const out = await applyFaceMask(img, boxes, mode, { padding: cfg.faces.boxPadding, mosaicCells: cfg.faces.mosaicCells });
        await sharp(out).toFile(path.join(outDir, `check-${i + 1}-${mode}.jpg`));
      }
    }
  } finally {
    await detector.close();
  }
  console.log(`결과: ${outDir}`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`실패: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
