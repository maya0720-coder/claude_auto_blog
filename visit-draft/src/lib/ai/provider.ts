/**
 * AI 공급자 선택: 설정 화면에서 고른 값(AI_PROVIDER 환경 변수) → 없으면 config/defaults.json의 ai.provider.
 * 파이프라인은 이 파일의 함수만 부른다.
 */
import { AI_PROVIDERS, type AiProvider, type Defaults } from "../config/schema";
import type { JobStore } from "../jobs/store";
import type { Job, JobInput, PhotoNote, PlaceResearch, PostDraft } from "../jobs/types";
import { anthropicAnalyze, anthropicErrorMessage, anthropicModel, anthropicResearch, anthropicWrite } from "./anthropic";
import { googleAnalyze, googleErrorMessage, googleModel, googleResearch, googleWrite } from "./google";
import { AiError } from "./shared";

export { AiError };

export function aiProvider(cfg: Defaults["ai"]): AiProvider {
  const env = process.env.AI_PROVIDER?.trim() as AiProvider | undefined;
  return env && AI_PROVIDERS.includes(env) ? env : cfg.provider;
}

export const PROVIDER_LABELS: Record<AiProvider, string> = { google: "Google Gemini", anthropic: "Anthropic Claude" };
export const PROVIDER_KEY_ENV: Record<AiProvider, string> = { google: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

export function aiModel(cfg: Defaults["ai"], provider = aiProvider(cfg)): string {
  return provider === "google" ? googleModel(cfg) : anthropicModel(cfg);
}

export function analyzePhotos(job: Job, store: JobStore, cfg: Defaults["ai"]): Promise<PhotoNote[]> {
  return aiProvider(cfg) === "google" ? googleAnalyze(job, store, cfg) : anthropicAnalyze(job, store, cfg);
}

/** 장소·제품 정보 조사. 사진 분석에서 읽은 글자를 같은 대상인지 확인하는 단서로 넘긴다 */
export function researchPlace(input: JobInput, cfg: Defaults["ai"], notes?: PhotoNote[]): Promise<PlaceResearch> {
  return aiProvider(cfg) === "google" ? googleResearch(input, cfg, notes) : anthropicResearch(input, cfg, notes);
}

export function writeDraft(job: Job, store: JobStore, cfg: Defaults["ai"]): Promise<PostDraft> {
  return aiProvider(cfg) === "google" ? googleWrite(job, store, cfg) : anthropicWrite(job, store, cfg);
}

/** 사용자에게 보여 줄 오류 문구. 키·요청 내용은 넣지 않는다. */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof AiError) return err.message;
  // Anthropic 오류는 클래스로 정확히 구분되므로 먼저 보고, 나머지는 상태 코드로 Google 오류로 본다
  return anthropicErrorMessage(err) ?? googleErrorMessage(err) ?? "AI 처리 중 알 수 없는 오류가 발생했습니다.";
}
