/**
 * Google Gemini 공급자(@google/genai, Interactions API):
 * 조사는 google_search·url_context 도구로, 원고는 사진(얼굴 가린 AI용 사본)을 보고 JSON 구조화 출력으로 받는다.
 * 요청 내용은 Google에 보관하지 않도록 store: false로 보낸다.
 */
import { readFileSync } from "node:fs";
import { ApiError, GoogleGenAI } from "@google/genai";
import type { Defaults } from "../config/schema";
import type { JobStore } from "../jobs/store";
import type { Job, JobInput, PhotoNote, PlaceResearch, PostDraft } from "../jobs/types";
import { analyzeUserPrompt, parsePhotoNotes, PHOTO_NOTES_JSON_SCHEMA } from "./photoNotes";
import {
  AiError,
  FLAT_DRAFT_JSON_SCHEMA,
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

export const googleModel = (cfg: Defaults["ai"]) => process.env.GEMINI_MODEL?.trim() || cfg.google.model;

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AiError("Google API 키가 없습니다. 화면 오른쪽 위 [설정]에서 키를 입력해 주세요.");
  return new GoogleGenAI({ apiKey });
}

/** 비스트리밍 응답에서 쓰는 부분만 */
interface Interaction {
  status: string;
  output_text?: string | undefined;
  steps?: unknown;
}

/** 완료되지 않은 응답(실패·잘림·차단)을 사용자 문구로 바꾼다. */
function assertCompleted(it: Interaction): string {
  if (it.status === "completed" && it.output_text) return it.output_text;
  if (it.status === "incomplete" || it.status === "budget_exceeded") {
    throw new AiError("AI 응답이 너무 길어 끊겼습니다. 글 길이를 줄이거나 사진 수를 줄여 다시 시도해 주세요.");
  }
  if (it.status === "completed") throw new AiError("AI가 이 요청에 답하지 않았습니다(안전 필터 등). 장소 이름이나 메모를 바꿔 다시 시도해 주세요.");
  throw new AiError(`AI가 요청을 끝내지 못했습니다(상태: ${String(it.status)}). 잠시 뒤 다시 시도해 주세요.`);
}

/** 응답 단계(steps) 안의 검색 인용(url_citation) 주소를 모은다. 구조가 바뀌어도 깨지지 않게 느슨하게 찾는다. */
export function collectCitationUrls(node: unknown, out = new Set<string>(), depth = 0): string[] {
  if (depth > 12 || !node || typeof node !== "object") return [...out];
  if (Array.isArray(node)) {
    for (const n of node) collectCitationUrls(n, out, depth + 1);
    return [...out];
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "url_citation" && typeof rec.url === "string") out.add(rec.url);
  for (const v of Object.values(rec)) if (v && typeof v === "object") collectCitationUrls(v, out, depth + 1);
  return [...out];
}

export async function googleResearch(input: JobInput, cfg: Defaults["ai"], notes?: PhotoNote[]): Promise<PlaceResearch> {
  const it = await client().interactions.create(
    {
      model: googleModel(cfg),
      system_instruction: loadPrompt(researchPromptName(input.kind)),
      input: researchUserPrompt(input, notes),
      tools: [{ type: "google_search" }, { type: "url_context" }],
      generation_config: { thinking_level: cfg.google.researchThinking, max_output_tokens: cfg.maxTokens },
      store: false,
      stream: false,
    },
    { timeout: cfg.requestTimeoutMs },
  );
  const text = assertCompleted(it);
  return parseResearch(text, new Date().toISOString(), collectCitationUrls(it.steps));
}

type Part = { type: "text"; text: string } | { type: "image"; data: string; mime_type: "image/jpeg" };

/** 사진(얼굴 가린 AI용 사본)마다 이름표 + 이미지 */
function photoParts(job: Job, store: JobStore): Part[] {
  return job.photos.flatMap((p): Part[] => [
    { type: "text", text: photoLabel(p) },
    { type: "image", data: readFileSync(store.photoPath(job.id, p, "ai")).toString("base64"), mime_type: "image/jpeg" },
  ]);
}

export async function googleAnalyze(job: Job, store: JobStore, cfg: Defaults["ai"]): Promise<PhotoNote[]> {
  const it = await client().interactions.create(
    {
      model: googleModel(cfg),
      system_instruction: loadPrompt("analyze"),
      input: [...photoParts(job, store), { type: "text", text: analyzeUserPrompt(job) }],
      response_format: { type: "text", mime_type: "application/json", schema: PHOTO_NOTES_JSON_SCHEMA },
      generation_config: { thinking_level: cfg.google.analyzeThinking, max_output_tokens: cfg.maxTokens },
      store: false,
      stream: false,
    },
    { timeout: cfg.requestTimeoutMs },
  );
  return parsePhotoNotes(assertCompleted(it), photoIdsOf(job));
}

export async function googleWrite(job: Job, store: JobStore, cfg: Defaults["ai"]): Promise<PostDraft> {
  const c = client();
  const parts: Part[] = [...photoParts(job, store), { type: "text", text: writerContext(job) }];

  let feedback: string | undefined;
  for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    const it = await c.interactions.create(
      {
        model: googleModel(cfg),
        system_instruction: loadPrompt("writer"),
        input: feedback ? [...parts, { type: "text", text: feedback }] : parts,
        response_format: { type: "text", mime_type: "application/json", schema: FLAT_DRAFT_JSON_SCHEMA },
        generation_config: { thinking_level: cfg.google.writerThinking, max_output_tokens: cfg.maxTokens },
        store: false,
        stream: false,
      },
      { timeout: cfg.requestTimeoutMs },
    );
    const text = assertCompleted(it);
    const { draft, problems } = parseDraft(text, photoIdsOf(job));
    if (draft) return draft;
    // 이전 답과 문제를 함께 보내 고친 원고를 다시 받는다(대화 기록을 Google에 저장하지 않기 위해 한 번에 보냄)
    feedback = `## 이전에 준 원고\n${text.slice(0, 20_000)}\n\n${fixRequest(problems)}`;
  }
  throw new AiError("원고를 만들지 못했습니다(형식 오류가 반복됨). 다시 시도해 주세요.");
}

const statusOf = (err: unknown): number | undefined => {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
};

/** Google SDK 오류를 사용자 문구로 바꾼다. 해당 없으면 undefined */
export function googleErrorMessage(err: unknown): string | undefined {
  const status = statusOf(err);
  if (status === 400 || status === 401 || status === 403) {
    return "Google API 키가 올바르지 않거나, 이 키로 Gemini API를 쓸 수 없습니다. [설정]에서 확인해 주세요.";
  }
  if (status === 404) return "설정된 Gemini 모델을 찾을 수 없습니다. 모델 이름을 확인해 주세요.";
  if (status === 429) return "Google API 사용 한도를 넘었습니다(무료 등급은 분당·일일 한도가 낮습니다). 잠시 뒤 다시 시도해 주세요.";
  if (status !== undefined && status >= 500) return `Google AI 서버 오류가 발생했습니다(${status}). 잠시 뒤 다시 시도해 주세요.`;
  const name = (err as { name?: unknown })?.name;
  if (typeof name === "string" && /Connection|Timeout|Abort/i.test(name)) return "Google AI 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
  return undefined;
}

/** 키 확인: 모델 정보 조회(토큰 비용 없음) */
export async function verifyGoogleKey(apiKey: string, model: string): Promise<"ok" | "rejected" | "unknown"> {
  try {
    await new GoogleGenAI({ apiKey }).models.get({ model });
    return "ok";
  } catch (err) {
    const status = err instanceof ApiError ? err.status : statusOf(err);
    if (status === 400 || status === 401 || status === 403 || status === 404) return "rejected";
    return "unknown";
  }
}
