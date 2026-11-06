import { rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@google/genai", () => import("../helpers/fakeGoogle"));

import { collectCitationUrls, googleAnalyze, googleResearch, googleWrite, verifyGoogleKey } from "../../src/lib/ai/google";
import { aiErrorMessage, aiModel, aiProvider, researchPlace } from "../../src/lib/ai/provider";
import { AiError } from "../../src/lib/ai/shared";
import { loadDefaults } from "../../src/lib/config/load";
import { JobStore } from "../../src/lib/jobs/store";
import type { Job } from "../../src/lib/jobs/types";
import { ApiError, done, googleCalls, googleReplies, modelGets } from "../helpers/fakeGoogle";

const cfg = loadDefaults();
const input: Job["input"] = {
  kind: "place",
  blogId: "test_blog",
  place: { name: "테스트 카페", link: "https://example.com/place" },
  memo: { good: "창가 자리가 좋았어요" },
  options: { faceMode: "mosaic", length: "normal", hashtagCount: 3, sortByTime: true },
};
const researchJson = JSON.stringify({ summary: "성수동 카페", facts: [{ label: "주소", value: "서울 성동구 1" }], sources: [] });

beforeEach(() => {
  googleCalls.length = 0;
  googleReplies.length = 0;
  modelGets.length = 0;
  // 가짜 SDK를 쓰므로 실제 키가 필요 없다. 비어 있지 않은 값만 넣는다
  vi.stubEnv("GEMINI_API_KEY", "placeholder-for-tests");
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("AI_PROVIDER", "");
});

describe("공급자 선택", () => {
  it("기본은 설정 파일(google), AI_PROVIDER 환경 변수로 바꿀 수 있다", () => {
    expect(aiProvider(cfg.ai)).toBe("google");
    expect(aiModel(cfg.ai)).toBe(cfg.ai.google.model);
    vi.stubEnv("AI_PROVIDER", "anthropic");
    expect(aiProvider(cfg.ai)).toBe("anthropic");
    vi.stubEnv("AI_PROVIDER", "unknown");
    expect(aiProvider(cfg.ai)).toBe("google");
  });
});

describe("Gemini 조사", () => {
  it("google_search·url_context 도구로 요청하고, 저장하지 않게 보내며, 검색 인용 주소를 출처에 합친다", async () => {
    const steps = [{ type: "model_output", content: [{ type: "text", annotations: [{ type: "url_citation", url: "https://example.com/news" }] }] }];
    googleReplies.push(done(`\`\`\`json\n${researchJson}\n\`\`\``, steps));
    const r = await researchPlace(input, cfg.ai);
    expect(r.summary).toBe("성수동 카페");
    expect(r.sources).toEqual(["https://example.com/news"]);
    const req = googleCalls[0]!;
    expect(req.model).toBe(cfg.ai.google.model);
    expect(req.tools).toEqual([{ type: "google_search" }, { type: "url_context" }]);
    expect(req.store).toBe(false);
    expect(req.stream).toBe(false);
    expect(String(req.input)).toContain("https://example.com/place");
    expect((req.generation_config as { thinking_level: string }).thinking_level).toBe(cfg.ai.google.researchThinking);
  });
  it("완료되지 않거나 잘린 응답은 사용자용 오류", async () => {
    googleReplies.push({ status: "incomplete" });
    await expect(googleResearch(input, cfg.ai)).rejects.toThrow(/길어/);
    googleReplies.push({ status: "failed" });
    await expect(googleResearch(input, cfg.ai)).rejects.toThrow(AiError);
    googleReplies.push({ status: "completed" });
    await expect(googleResearch(input, cfg.ai)).rejects.toThrow(/답하지 않았습니다/);
  });
  it("키가 없으면 설정 안내, 모델은 GEMINI_MODEL로 바꿀 수 있다", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(googleResearch(input, cfg.ai)).rejects.toThrow(/설정/);
    vi.stubEnv("GEMINI_API_KEY", "placeholder-for-tests");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    googleReplies.push(done(researchJson));
    await googleResearch(input, cfg.ai);
    expect(googleCalls.at(-1)!.model).toBe("gemini-3.8-flash");
  });
});

describe("Gemini 원고", () => {
  const relDir = path.join("data", "test-google", String(process.pid));
  const store = new JobStore({ dir: relDir, retentionDays: 7, styleCacheHours: 0 });
  afterAll(() => {
    rmSync(path.resolve(relDir), { recursive: true, force: true });
    try {
      rmdirSync(path.dirname(path.resolve(relDir)));
    } catch {
      // 비어 있지 않음
    }
  });
  const id = "66666666-2222-4333-8444-555555555555";
  const job: Job = {
    id,
    createdAt: "t",
    updatedAt: "t",
    status: "processing",
    input,
    photos: [
      { id: "p1", ext: ".jpg", faces: [], aiWidth: 10 },
      { id: "p2", ext: ".jpg", faces: [], aiWidth: 10 },
    ],
  };
  store.create(job);
  for (const p of job.photos) writeFileSync(store.photoPath(id, p, "ai"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  // Gemini용 평평한 블록(종류와 맞지 않는 필드가 섞여 와도 정리되는지 확인)
  const flat = {
    title: "성수 카페",
    titleCandidates: ["a"],
    blocks: [
      { type: "photo", photoId: "p1", caption: "외관", text: "" },
      { type: "text", text: "창가 자리가 좋았어요.", photoId: "" },
      { type: "photo", photoId: "p2", caption: "커피" },
    ],
    hashtags: ["성수카페"],
  };

  it("사진 분석: 분석용 지시문·생각 수준으로 요청하고 사진별 설명을 받는다", async () => {
    googleReplies.push(done(JSON.stringify({ photos: [{ photoId: "p1", category: "외관", description: "가게 앞", visibleText: "", caption: "외관" }, { photoId: "p2", category: "음료", description: "커피", visibleText: "", caption: "커피" }] })));
    const notes = await googleAnalyze(job, store, cfg.ai);
    expect(notes).toHaveLength(2);
    const req = googleCalls[0]!;
    expect(String(req.system_instruction)).toContain("사진 분석가");
    expect((req.generation_config as { thinking_level: string }).thinking_level).toBe(cfg.ai.google.analyzeThinking);
    expect(req.response_format).toMatchObject({ mime_type: "application/json" });
    expect(req.store).toBe(false);
    expect((req.input as { type: string }[]).filter((p) => p.type === "image")).toHaveLength(2);
  });

  it("제품 후기 조사는 제품 조사 지시문을 쓴다", async () => {
    googleReplies.push(done(researchJson));
    await googleResearch({ ...input, kind: "product" }, cfg.ai);
    expect(String(googleCalls[0]!.system_instruction)).toContain("제품의 사실 정보");
  });

  it("사진을 inline image로 보내고 JSON 구조화 출력을 받는다", async () => {
    googleReplies.push(done(JSON.stringify(flat)));
    const d = await googleWrite(job, store, cfg.ai);
    expect(d.blocks).toEqual([
      { type: "photo", photoId: "p1", caption: "외관" },
      { type: "text", text: "창가 자리가 좋았어요." },
      { type: "photo", photoId: "p2", caption: "커피" },
    ]);
    const req = googleCalls[0]!;
    const parts = req.input as { type: string; mime_type?: string }[];
    expect(parts.filter((p) => p.type === "image")).toEqual([
      expect.objectContaining({ type: "image", mime_type: "image/jpeg" }),
      expect.objectContaining({ type: "image", mime_type: "image/jpeg" }),
    ]);
    expect(req.response_format).toMatchObject({ type: "text", mime_type: "application/json" });
    expect(req.store).toBe(false);
  });

  it("사진이 빠지면 이전 답과 문제를 함께 보내 다시 요청한다", async () => {
    const missing = { ...flat, blocks: flat.blocks.slice(0, 2) };
    googleReplies.push(done(JSON.stringify(missing)), done(JSON.stringify(flat)));
    await googleWrite(job, store, cfg.ai);
    expect(googleCalls).toHaveLength(2);
    const second = JSON.stringify(googleCalls[1]!.input);
    expect(second).toContain("빠진 사진");
    expect(second).toContain("이전에 준 원고");
  });
});

describe("Gemini 오류·키 확인", () => {
  it("상태 코드별 문구", () => {
    expect(aiErrorMessage(new ApiError(403))).toContain("Google API 키");
    expect(aiErrorMessage(new ApiError(429))).toContain("한도");
    expect(aiErrorMessage(new ApiError(503))).toContain("503");
    expect(aiErrorMessage(new Error("secret"))).not.toContain("secret");
  });
  it("키 확인은 모델 정보 조회로 한다", async () => {
    expect(await verifyGoogleKey("placeholder", "gemini-3.6-flash")).toBe("ok");
    expect(modelGets).toEqual(["gemini-3.6-flash"]);
    expect(await verifyGoogleKey("rejected-key", "gemini-3.6-flash")).toBe("rejected");
  });
  it("인용 주소는 깊은 구조에서도 찾는다", () => {
    expect(collectCitationUrls([{ a: { b: [{ type: "url_citation", url: "https://x.example" }] } }])).toEqual(["https://x.example"]);
    expect(collectCitationUrls(undefined)).toEqual([]);
  });
});
