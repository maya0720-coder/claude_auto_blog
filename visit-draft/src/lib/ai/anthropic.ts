/** Anthropic Claude 공급자: 웹 검색 조사, 사진을 보고 원고 작성 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { Defaults } from "../config/schema";
import type { JobStore } from "../jobs/store";
import type { Job, JobInput, PhotoNote, PlaceResearch, PostDraft } from "../jobs/types";
import { analyzeUserPrompt, parsePhotoNotes, PHOTO_NOTES_JSON_SCHEMA } from "./photoNotes";
import {
  AiError,
  DRAFT_JSON_SCHEMA,
  fixRequest,
  loadPrompt,
  MAX_FIX_ATTEMPTS,
  parseDraft,
  parseResearch,
  photoIdsOf,
  photoLabel,
  researchPromptName,
  researchUserPrompt,
  writerContext,
} from "./shared";

/** 안전 분류기가 거절하면 서버가 권장 모델로 다시 실행하도록 한다("default" 형식 전용 헤더) */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;
/** 서버 도구 반복이 길어지면 응답이 pause_turn으로 멈춘다. 이어서 실행할 최대 횟수 */
const MAX_RESUMES = 3;

export const anthropicModel = (cfg: Defaults["ai"]) => process.env.ANTHROPIC_MODEL?.trim() || cfg.anthropic.model;

function client(cfg: Defaults["ai"]): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new AiError("Anthropic API 키가 없습니다. 화면 오른쪽 위 [설정]에서 키를 입력해 주세요.");
  return new Anthropic({ apiKey, timeout: cfg.requestTimeoutMs, maxRetries: 2 });
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function assertUsable(msg: Anthropic.Beta.BetaMessage): void {
  if (msg.stop_reason === "refusal") {
    throw new AiError("AI가 이 요청을 처리하지 않았습니다. 장소 이름이나 메모를 바꿔 다시 시도해 주세요.");
  }
  if (msg.stop_reason === "max_tokens") {
    throw new AiError("AI 응답이 너무 길어 끊겼습니다. 글 길이를 줄이거나 사진 수를 줄여 다시 시도해 주세요.");
  }
}

export async function anthropicResearch(input: JobInput, cfg: Defaults["ai"], notes?: PhotoNote[]): Promise<PlaceResearch> {
  const c = client(cfg);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: researchUserPrompt(input, notes) }];
  let msg: Anthropic.Beta.BetaMessage | undefined;
  for (let i = 0; i <= MAX_RESUMES; i++) {
    msg = await c.beta.messages
      .stream({
        model: anthropicModel(cfg),
        max_tokens: cfg.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: cfg.anthropic.researchEffort },
        system: loadPrompt(researchPromptName(input.kind)),
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: cfg.maxWebSearches },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: cfg.maxWebFetches },
        ],
        messages,
      })
      .finalMessage();
    if (msg.stop_reason !== "pause_turn") break;
    // 멈춘 지점부터 서버가 이어서 하도록 응답을 그대로 붙여 다시 보낸다
    messages.push({ role: "assistant", content: msg.content });
  }
  if (!msg) throw new AiError("장소 조사에 실패했습니다.");
  assertUsable(msg);
  if (msg.stop_reason === "pause_turn") throw new AiError("장소 조사가 너무 오래 걸려 중단했습니다. 다시 시도해 주세요.");
  return parseResearch(textOf(msg.content), new Date().toISOString());
}

/** 사진(얼굴 가린 AI용 사본)마다 이름표 + 이미지 */
function photoContent(job: Job, store: JobStore): Anthropic.Beta.BetaContentBlockParam[] {
  return job.photos.flatMap((p): Anthropic.Beta.BetaContentBlockParam[] => [
    { type: "text", text: photoLabel(p) },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(store.photoPath(job.id, p, "ai")).toString("base64") } },
  ]);
}

export async function anthropicAnalyze(job: Job, store: JobStore, cfg: Defaults["ai"]): Promise<PhotoNote[]> {
  const msg = await client(cfg)
    .beta.messages.stream({
      model: anthropicModel(cfg),
      max_tokens: cfg.maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: cfg.anthropic.analyzeEffort, format: { type: "json_schema", schema: PHOTO_NOTES_JSON_SCHEMA } },
      system: loadPrompt("analyze"),
      messages: [{ role: "user", content: [...photoContent(job, store), { type: "text", text: analyzeUserPrompt(job) }] }],
    })
    .finalMessage();
  assertUsable(msg);
  return parsePhotoNotes(textOf(msg.content), photoIdsOf(job));
}

export async function anthropicWrite(job: Job, store: JobStore, cfg: Defaults["ai"]): Promise<PostDraft> {
  const c = client(cfg);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [...photoContent(job, store), { type: "text", text: writerContext(job) }];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];

  for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    const msg = await c.beta.messages
      .stream({
        model: anthropicModel(cfg),
        max_tokens: cfg.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: cfg.anthropic.writerEffort, format: { type: "json_schema", schema: DRAFT_JSON_SCHEMA } },
        system: loadPrompt("writer"),
        messages,
      })
      .finalMessage();
    assertUsable(msg);
    const { draft, problems } = parseDraft(textOf(msg.content), photoIdsOf(job));
    if (draft) return draft;
    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: fixRequest(problems) });
  }
  throw new AiError("원고를 만들지 못했습니다(형식 오류가 반복됨). 다시 시도해 주세요.");
}

/** Anthropic SDK 오류를 사용자 문구로 바꾼다. 해당 없으면 undefined */
export function anthropicErrorMessage(err: unknown): string | undefined {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic API 키가 올바르지 않습니다. [설정]에서 다시 입력해 주세요.";
  if (err instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 해당 모델이나 기능을 쓸 수 없습니다.";
  if (err instanceof Anthropic.RateLimitError) return "요청이 많아 잠시 막혔습니다. 몇 분 뒤 다시 시도해 주세요.";
  if (err instanceof Anthropic.BadRequestError) return "AI 요청 형식에 문제가 있습니다. 사진 수를 줄이거나 다시 시도해 주세요.";
  if (err instanceof Anthropic.APIConnectionError) return "AI 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
  if (err instanceof Anthropic.APIError) return `AI 서버 오류가 발생했습니다(${err.status ?? "알 수 없음"}). 잠시 뒤 다시 시도해 주세요.`;
  return undefined;
}

/** 키 확인: 모델 정보 조회(토큰 비용 없음) */
export async function verifyAnthropicKey(apiKey: string, model: string): Promise<"ok" | "rejected" | "unknown"> {
  try {
    await new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 }).models.retrieve(model);
    return "ok";
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
      return "rejected";
    }
    return "unknown";
  }
}
