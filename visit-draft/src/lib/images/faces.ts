/**
 * 얼굴 찾기. 사진을 외부(AI)로 보내기 전에 이 PC 안에서만 실행한다.
 * Playwright의 헤드리스 Chromium에서 @vladmandic/human(BlazeFace)을 돌린다.
 * 라이브러리·모델 파일은 node_modules에서만 제공하고, 외부 네트워크 요청은 모두 막는다.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { PROJECT_ROOT } from "../config/load";
import type { Defaults } from "../config/schema";
import { mergeBoxes, tileRects } from "./faceTiles";

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

const ORIGIN = "http://face.local";
const HUMAN_DIR = path.join(/*turbopackIgnore: true*/ PROJECT_ROOT, "node_modules", "@vladmandic", "human");
const FILES: Record<string, { file: string; type: string }> = {
  "/human.esm.js": { file: path.join(HUMAN_DIR, "dist", "human.esm.js"), type: "text/javascript" },
  "/models/blazeface.json": { file: path.join(HUMAN_DIR, "models", "blazeface.json"), type: "application/json" },
  "/models/blazeface.bin": { file: path.join(HUMAN_DIR, "models", "blazeface.bin"), type: "application/octet-stream" },
};

function pageHtml(cfg: Defaults["faces"]): string {
  const config = {
    backend: "webgl",
    modelBasePath: `${ORIGIN}/models/`,
    cacheSensitivity: 0,
    filter: { enabled: false },
    face: {
      enabled: true,
      detector: { modelPath: "blazeface.json", rotation: false, maxDetected: cfg.maxFaces, minConfidence: cfg.minConfidence, return: false },
      mesh: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false },
      attention: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
    segmentation: { enabled: false },
  };
  return `<!doctype html><meta charset="utf-8"><script type="module">
import { Human } from "/human.esm.js";
const human = new Human(${JSON.stringify(config)});
try {
  await human.load();
  window.detectFaces = async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const res = await human.detect(img);
    return res.face.map((f) => ({ box: f.box, score: f.boxScore ?? f.score ?? 0 }));
  };
  window.__ready = "ok";
} catch (e) {
  window.__ready = "error:" + (e && e.message ? e.message : String(e));
}
</script>`;
}

export class FaceDetectError extends Error {
  override name = "FaceDetectError";
}

/** 여러 장을 연속으로 처리할 수 있도록 브라우저를 한 번 열어 재사용한다. 다 쓰면 close()를 부른다. */
export class FaceDetector {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly timeoutMs: number,
  ) {}

  static async open(cfg: Defaults["faces"]): Promise<FaceDetector> {
    for (const { file } of Object.values(FILES)) {
      if (!existsSync(file)) throw new FaceDetectError("얼굴 인식 모델 파일이 없습니다. npm install을 다시 실행해 주세요.");
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      // 허용한 로컬 파일만 응답하고, 그 밖의 모든 요청(외부 네트워크 포함)은 막는다
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) return route.abort();
        if (url.pathname === "/") {
          return route.fulfill({ contentType: "text/html", body: pageHtml(cfg) });
        }
        const entry = FILES[url.pathname];
        if (!entry) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ contentType: entry.type, body: readFileSync(/*turbopackIgnore: true*/ entry.file) });
      });
      await page.goto(`${ORIGIN}/`);
      await page.waitForFunction(() => (window as unknown as { __ready?: string }).__ready, undefined, {
        timeout: cfg.detectTimeoutMs,
      });
      const ready = await page.evaluate(() => (window as unknown as { __ready: string }).__ready);
      if (ready !== "ok") throw new FaceDetectError(`얼굴 인식 준비 실패: ${ready}`);
      return new FaceDetector(browser, page, cfg.detectTimeoutMs);
    } catch (err) {
      await browser.close();
      throw err;
    }
  }

  /**
   * JPEG/PNG 이미지에서 얼굴 상자(픽셀 좌표)를 찾는다.
   * 사진 전체와 겹치는 조각들을 각각 살펴본 뒤 합친다(가로로 긴 사진·작은 얼굴 누락 방지).
   */
  async detect(image: Buffer, mime: "image/jpeg" | "image/png"): Promise<FaceBox[]> {
    const meta = await sharp(image).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return [];
    const found: FaceBox[] = [];
    for (const r of tileRects(w, h)) {
      const isFull = r.width === w && r.height === h;
      const piece = isFull ? image : await sharp(image).extract(r).jpeg({ quality: 92 }).toBuffer();
      const boxes = await this.detectOnce(piece, isFull ? mime : "image/jpeg");
      for (const b of boxes) found.push({ ...b, x: b.x + r.left, y: b.y + r.top });
    }
    return mergeBoxes(found);
  }

  private async detectOnce(image: Buffer, mime: "image/jpeg" | "image/png"): Promise<FaceBox[]> {
    const dataUrl = `data:${mime};base64,${image.toString("base64")}`;
    const raw = (await Promise.race([
      this.page.evaluate(
        (u) => (window as unknown as { detectFaces: (u: string) => Promise<unknown> }).detectFaces(u),
        dataUrl,
      ),
      new Promise((_, reject) => setTimeout(() => reject(new FaceDetectError("얼굴 인식 시간 초과")), this.timeoutMs)),
    ])) as { box: [number, number, number, number]; score: number }[];
    return raw
      .filter((f) => Array.isArray(f.box) && f.box.every((n) => Number.isFinite(n)))
      .map((f) => ({ x: f.box[0], y: f.box[1], width: f.box[2], height: f.box[3], score: f.score }));
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
