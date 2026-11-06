/**
 * 원고 만들기 파이프라인 통합 테스트: 실제 사진 처리(회전·EXIF 제거·얼굴 인식 브라우저)는 그대로 돌리고,
 * AI(기본 공급자 Google Gemini)와 블로그 읽기(네이버)만 가짜로 바꾼다. 외부로 아무것도 보내지 않는다.
 */
import { existsSync, readFileSync, rmSync, writeFileSync, rmdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@google/genai", () => import("../helpers/fakeGoogle"));
vi.mock("../../src/lib/naver/styleNote", () => ({
  buildStyleNote: async () => "### 참고 글 1\n안녕하세요 이웃님들~ 😊",
}));

import { loadDefaults, loadSelectors } from "../../src/lib/config/load";
import { runGenerate } from "../../src/lib/jobs/generate";
import { JobStore } from "../../src/lib/jobs/store";
import type { Job } from "../../src/lib/jobs/types";
import type { RunEvent } from "../../src/lib/runs/types";
import { done, googleCalls, googleReplies } from "../helpers/fakeGoogle";

const cfg = loadDefaults();
const sel = loadSelectors();
const relDir = path.join("data", "test-generate", String(process.pid));
const store = new JobStore({ ...cfg.jobs, dir: relDir });
const id = "55555555-2222-4333-8444-555555555555";

beforeAll(async () => {
  vi.stubEnv("GEMINI_API_KEY", "placeholder-for-tests");
  vi.stubEnv("AI_PROVIDER", "google");
  const now = new Date().toISOString();
  const job: Job = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "processing",
    input: {
      kind: "place",
      blogId: "test_blog",
      place: { name: "테스트 카페" },
      memo: {},
      options: { faceMode: "mosaic", length: "normal", hashtagCount: 2, sortByTime: true, disclosure: "제공받아 작성했습니다." },
    },
    photos: [
      { id: "p1", ext: ".jpg", faces: [], aiWidth: 1 },
      { id: "p2", ext: ".png", faces: [], aiWidth: 1 },
    ],
  };
  store.create(job);
  // p1: 큰 사진 + EXIF(위치 정보 대용 필드·촬영 시각). p2: 작은 PNG(EXIF 없음)
  await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#8a7" } })
    .withExif({ IFD0: { Copyright: "synthetic-test" }, IFD2: { DateTimeOriginal: "2026:11:01 12:30:00" } })
    .jpeg()
    .toFile(store.photoPath(id, job.photos[0]!, "original"));
  writeFileSync(
    store.photoPath(id, job.photos[1]!, "original"),
    await sharp({ create: { width: 300, height: 200, channels: 3, background: "#58a" } }).png().toBuffer(),
  );
}, 60_000);
afterAll(() => {
  rmSync(path.resolve(relDir), { recursive: true, force: true });
  // 비어 있는 상위 테스트 폴더도 지운다(다른 테스트가 쓰는 중이면 남겨 둔다)
  try {
    rmdirSync(path.dirname(path.resolve(relDir)));
  } catch {
    // 비어 있지 않음
  }
});

describe("runGenerate", () => {
  it("사진 준비 → 사진 분석 → 문체 → 조사(실패해도 계속) → 원고, 협찬 표기를 보장한다", async () => {
    googleReplies.push(
      // 사진 분석: 모르는 사진 ID(p9)는 버린다
      done(
        JSON.stringify({
          photos: [
            { photoId: "p1", category: "외관", description: "초록색 벽", visibleText: "TEST CAFE", caption: "초록 벽 외관" },
            { photoId: "p2", category: "실내", description: "파란색 벽", visibleText: "", caption: "파란 벽" },
            { photoId: "p9", category: "기타", description: "없는 사진", visibleText: "", caption: "" },
          ],
        }),
      ),
      { status: "failed" }, // 조사: 실패 → 경고 후 계속
      done(
        JSON.stringify({
          title: "테스트 카페 후기",
          titleCandidates: ["후보 1"],
          blocks: [
            { type: "photo", photoId: "p1", caption: "초록 벽" },
            { type: "text", text: "사진에 보이는 초록 벽이 인상적이에요." },
            { type: "photo", photoId: "p2", caption: "파란 벽" },
          ],
          hashtags: ["테스트카페", "카페"],
        }),
      ),
    );
    const events: RunEvent[] = [];
    await runGenerate(id, store, cfg, sel, (e) => events.push(e), { full: true });

    const job = store.read(id)!;
    expect(job.status).toBe("draft_ready");
    expect(job.styleNote).toContain("참고 글 1");
    expect(job.research).toBeUndefined();
    expect(job.photoNotes?.map((n) => n.photoId)).toEqual(["p1", "p2"]);
    expect(job.photoNotes?.[1]?.visibleText).toBeUndefined();
    expect(job.draft!.blocks[0]).toEqual({ type: "text", text: "제공받아 작성했습니다." });
    expect(job.photos[0]!.takenAt).toMatch(/^2026-11-01/);

    const steps = events.filter((e): e is Extract<RunEvent, { type: "step" }> => e.type === "step");
    expect(steps.filter((s) => s.status !== "running").map((s) => `${s.step}:${s.status}`)).toEqual([
      "photos:ok",
      "analyze:ok",
      "style:ok",
      "research:warning",
      "write:ok",
    ]);

    // 업로드용·AI용 사본: 크기 제한, EXIF 없음
    for (const kind of ["ai", "upload"] as const) {
      const file = store.photoPath(id, job.photos[0]!, kind);
      const meta = await sharp(file).metadata();
      expect(meta.exif).toBeUndefined();
      expect(Math.max(meta.width!, meta.height!)).toBe(kind === "ai" ? cfg.images.aiMaxEdge : cfg.images.uploadMaxEdge);
    }
    // 원본은 그대로(EXIF 유지)
    expect((await sharp(store.photoPath(id, job.photos[0]!, "original")).metadata()).exif).toBeDefined();

    // AI로 보낸 사진은 AI용 사본뿐이다(원본 크기 이미지가 요청에 없어야 함)
    // 조사 요청에는 사진에서 읽은 글자가 단서로 들어간다
    expect(String(googleCalls[1]!.input)).toContain("TEST CAFE");
    const writerReq = googleCalls.at(-1)!;
    expect(JSON.stringify(writerReq.input)).toContain("초록 벽 외관");
    const images = (writerReq.input as { type: string; data?: string }[]).filter((c) => c.type === "image");
    expect(images).toHaveLength(2);
    const aiCopy = readFileSync(store.photoPath(id, job.photos[0]!, "ai")).toString("base64");
    expect(images.some((i) => i.data === aiCopy)).toBe(true);
  }, 120_000);

  it("원고 작성이 실패하면 작업을 실패로 표시하고 사용자용 문구로 알린다", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(runGenerate(id, store, cfg, sel, () => {}, { full: false })).rejects.toThrow(/설정/);
    expect(store.read(id)!.status).toBe("failed");
    expect(existsSync(store.dir(id))).toBe(true);
  });
});
