import { rmSync, writeFileSync, rmdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => import("../helpers/fakeAnthropic"));

import Anthropic from "@anthropic-ai/sdk";
import { anthropicAnalyze, anthropicResearch as researchPlace, anthropicWrite as writeDraft, FALLBACK_BETA } from "../../src/lib/ai/anthropic";
import { aiErrorMessage } from "../../src/lib/ai/provider";
import { AiError, parseResearch } from "../../src/lib/ai/shared";
import { loadDefaults } from "../../src/lib/config/load";
import { JobStore } from "../../src/lib/jobs/store";
import type { Job } from "../../src/lib/jobs/types";
import { calls, replies, textReply } from "../helpers/fakeAnthropic";

const cfg = loadDefaults();
const input: Job["input"] = {
  kind: "place",
  blogId: "test_blog",
  place: { name: "테스트 카페", area: "서울 성동구" },
  memo: { good: "창가 자리가 좋았어요" },
  options: { faceMode: "mosaic", length: "normal", hashtagCount: 3, sortByTime: true },
};
const researchJson = JSON.stringify({
  summary: "성수동 카페",
  facts: [
    { label: "주소", value: "서울 성동구 테스트로 1", source: "https://example.com/place" },
    { label: "영업시간", value: "10:00~21:00", source: "javascript:alert(1)" },
  ],
  sources: ["https://example.com/place", "file:///etc/passwd"],
});

beforeEach(() => {
  calls.length = 0;
  replies.length = 0;
  // 가짜 SDK를 쓰므로 실제 키가 필요 없다. 비어 있지 않은 값만 넣는다
  vi.stubEnv("ANTHROPIC_API_KEY", "placeholder-for-tests");
  vi.stubEnv("ANTHROPIC_MODEL", "");
});

describe("parseResearch", () => {
  it("```json 블록을 읽고 http(s)가 아닌 출처는 버린다", () => {
    const r = parseResearch(`조사 결과입니다.\n\`\`\`json\n${researchJson}\n\`\`\``, "t");
    expect(r.sources).toEqual(["https://example.com/place"]);
    expect(r.facts[1]).toEqual({ label: "영업시간", value: "10:00~21:00" });
  });
  it("JSON이 없으면 AiError", () => {
    expect(() => parseResearch("결과 없음", "t")).toThrow(AiError);
  });
});

describe("Anthropic 조사", () => {
  it("웹 검색·읽기 도구와 거절 대비를 켜고, pause_turn이면 이어서 요청한다", async () => {
    replies.push(textReply("검색 중", "pause_turn"), textReply(`\`\`\`json\n${researchJson}\n\`\`\``));
    const r = await researchPlace(input, cfg.ai);
    expect(r.summary).toBe("성수동 카페");
    expect(calls).toHaveLength(2);
    const first = calls[0]!;
    expect(first.model).toBe(cfg.ai.anthropic.model);
    expect(first.betas).toEqual([FALLBACK_BETA]);
    expect(first.fallbacks).toBe("default");
    expect((first.tools as { type: string }[]).map((t) => t.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    expect(JSON.stringify(first.messages)).toContain("테스트 카페");
    // 두 번째 요청에는 멈춘 응답이 assistant 차례로 붙어 있어야 한다
    expect((calls[1]!.messages as { role: string }[]).map((m) => m.role)).toEqual(["user", "assistant"]);
  });
  it("거절되면 사용자용 오류", async () => {
    replies.push(textReply("", "refusal"));
    await expect(researchPlace(input, cfg.ai)).rejects.toThrow(AiError);
  });
  it("ANTHROPIC_MODEL 환경 변수가 있으면 그 모델을 쓴다", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5-5");
    replies.push(textReply(`\`\`\`json\n${researchJson}\n\`\`\``));
    await researchPlace(input, cfg.ai);
    expect(calls[0]!.model).toBe("claude-sonnet-5-5");
  });
  it("API 키가 없으면 설정 안내", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(researchPlace(input, cfg.ai)).rejects.toThrow(/설정/);
    expect(calls).toHaveLength(0);
  });
});

describe("Anthropic 원고", () => {
  const relDir = path.join("data", "test-ai", String(process.pid));
  const store = new JobStore({ dir: relDir, retentionDays: 7, styleCacheHours: 0 });
  afterAll(() => {
  rmSync(path.resolve(relDir), { recursive: true, force: true });
  // 비어 있는 상위 테스트 폴더도 지운다(다른 테스트가 쓰는 중이면 남겨 둔다)
  try {
    rmdirSync(path.dirname(path.resolve(relDir)));
  } catch {
    // 비어 있지 않음
  }
});
  const id = "44444444-2222-4333-8444-555555555555";
  const job: Job = {
    id,
    createdAt: "t",
    updatedAt: "t",
    status: "processing",
    input,
    photos: [
      { id: "p1", ext: ".jpg", faces: [{ x: 1, y: 1, width: 5, height: 5, score: 0.9 }], aiWidth: 10, takenAt: "2026-11-01T03:00:00.000Z" },
      { id: "p2", ext: ".jpg", faces: [], aiWidth: 10 },
    ],
    styleNote: "### 참고 글 1\n안녕하세요~",
  };
  store.create(job);
  for (const p of job.photos) writeFileSync(store.photoPath(id, p, "ai"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const good = {
    title: "성수 카페",
    titleCandidates: ["a", "b"],
    blocks: [
      { type: "photo", photoId: "p1", caption: "외관" },
      { type: "text", text: "창가 자리가 좋았어요." },
      { type: "photo", photoId: "p2", caption: "커피" },
    ],
    hashtags: ["성수카페"],
  };

  it("사진 분석: 사진을 보내고 json_schema 구조화 출력으로 사진별 설명을 받는다", async () => {
    replies.push(textReply(JSON.stringify({ photos: [{ photoId: "p1", category: "외관", description: "가게 앞", visibleText: "", caption: "외관" }, { photoId: "p2", category: "음료", description: "커피", visibleText: "", caption: "커피" }] })));
    const notes = await anthropicAnalyze(job, store, cfg.ai);
    expect(notes.map((n) => n.category)).toEqual(["외관", "음료"]);
    const req = calls[0]!;
    expect((req.output_config as { effort: string; format: { type: string } }).effort).toBe(cfg.ai.anthropic.analyzeEffort);
    expect((req.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(String(req.system)).toContain("사진 분석가");
    const content = (req.messages as { content: { type: string }[] }[])[0]!.content;
    expect(content.filter((c) => c.type === "image")).toHaveLength(2);
  });

  it("사진(AI용 사본)·조사·메모·문체를 보내고, 구조화 출력으로 원고를 받는다", async () => {
    replies.push(textReply(JSON.stringify(good)));
    const d = await writeDraft(job, store, cfg.ai);
    expect(d.title).toBe("성수 카페");
    const req = calls[0]!;
    expect((req.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    const content = (req.messages as { content: { type: string; text?: string }[] }[])[0]!.content;
    expect(content.filter((c) => c.type === "image")).toHaveLength(2);
    const text = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    expect(text).toContain("창가 자리가 좋았어요");
    expect(text).toContain("얼굴 1명 가림");
    expect(text).toContain("참고 글 1");
  });

  it("사진이 빠진 원고는 문제를 알려 주고 다시 요청한다", async () => {
    const missing = { ...good, blocks: good.blocks.filter((b) => b.type !== "photo" || b.photoId !== "p2") };
    replies.push(textReply(JSON.stringify(missing)), textReply(JSON.stringify(good)));
    const d = await writeDraft(job, store, cfg.ai);
    expect(d.blocks).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.messages)).toContain("빠진 사진");
  });

  it("계속 형식이 틀리면 포기한다", async () => {
    replies.push(textReply("not json"), textReply("not json"), textReply("not json"));
    await expect(writeDraft(job, store, cfg.ai)).rejects.toThrow(AiError);
  });
});

describe("aiErrorMessage", () => {
  it("인증 오류·연결 오류를 알기 쉬운 문구로 바꾼다", () => {
    // 가짜 SDK의 오류 클래스는 생성자 인자가 단순하다(실제 SDK 타입과 다름)
    type FakeErr = new (message: string, status?: number) => Error;
    const AuthErr = Anthropic.AuthenticationError as unknown as FakeErr;
    const ConnErr = Anthropic.APIConnectionError as unknown as FakeErr;
    expect(aiErrorMessage(new AuthErr("x", 401))).toContain("API 키");
    expect(aiErrorMessage(new ConnErr("x"))).toContain("인터넷");
    expect(aiErrorMessage(new Error("secret"))).not.toContain("secret");
  });
});
