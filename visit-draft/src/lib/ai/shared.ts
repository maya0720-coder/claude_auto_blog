/**
 * AI 공급자(Google Gemini / Anthropic Claude)와 상관없이 쓰는 부분:
 * 프롬프트 파일, 요청 문구 만들기, 결과 검증(zod·사진 정합성). 공급자별 호출 코드는 google.ts / anthropic.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../config/load";
import { isNaverBookingUrl } from "../jobs/placeInfo";
import { KIND_TEXT, memoLines } from "../jobs/reviewKinds";
import { cleanReviewPoints, reviewPointSections } from "../jobs/reviewPoints";
import {
  checkDraft,
  draftSchema,
  researchSchema,
  type Job,
  type JobInput,
  type PhotoNote,
  type PlaceResearch,
  type PostDraft,
  type ReviewKind,
} from "../jobs/types";

export class AiError extends Error {
  override name = "AiError";
}

/** 잘못된 원고를 고쳐 달라고 다시 요청하는 최대 횟수(설계서 9.4) */
export const MAX_FIX_ATTEMPTS = 2;

/** prompts/ 폴더의 시스템 프롬프트를 읽는다. 이름은 코드에서 정한 값만 쓴다. */
export type PromptName = "research" | "research-product" | "analyze" | "writer";

export function loadPrompt(name: PromptName): string {
  return readFileSync(path.join(/*turbopackIgnore: true*/ PROJECT_ROOT, "prompts", `${name}.system.md`), "utf8");
}

const isWebUrl = (u: string) => /^https?:\/\//i.test(u);

/** 응답 텍스트에서 마지막 ```json 블록(없으면 가장 바깥 중괄호)을 찾아 검증한다. 추가 출처(검색 인용)를 합칠 수 있다. */
export function parseResearch(text: string, checkedAt: string, extraSources: string[] = []): PlaceResearch {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].at(-1)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    throw new AiError("장소 조사 결과를 읽지 못했습니다. 다시 시도해 주세요.");
  }
  // 후기 포인트는 항목별로 걸러, 일부가 틀려도 조사 결과 전체를 버리지 않는다
  const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const reviewPoints = cleanReviewPoints(rawObj.reviewPoints);
  const parsed = researchSchema.safeParse({ ...rawObj, reviewPoints, checkedAt });
  if (!parsed.success) throw new AiError("장소 조사 결과 형식이 올바르지 않습니다. 다시 시도해 주세요.");
  // 출처 URL은 http(s)만 남긴다(화면에서 링크로 보여 주므로)
  const sources = [...new Set([...parsed.data.sources, ...extraSources].filter(isWebUrl))].slice(0, 30);
  // 예약 링크는 네이버 예약 형식일 때만 남긴다(다른 주소를 글에 넣지 않음)
  const booking = parsed.data.links?.naverBooking?.trim();
  const { links: _links, ...rest } = parsed.data;
  return {
    ...rest,
    ...(isNaverBookingUrl(booking) ? { links: { naverBooking: booking } } : {}),
    sources,
    facts: parsed.data.facts.map((f) => (f.source && !isWebUrl(f.source) ? { label: f.label, value: f.value } : f)),
  };
}

/** 후기 종류에 맞는 조사 프롬프트 이름 */
export const researchPromptName = (kind: ReviewKind): PromptName => (kind === "product" ? "research-product" : "research");

export function researchUserPrompt(input: JobInput, notes?: PhotoNote[]): string {
  const p = input.place;
  const k = KIND_TEXT[input.kind];
  const clues = notes?.flatMap((n) => (n.visibleText ? [`- ${n.photoId}: ${n.visibleText}`] : [])) ?? [];
  return [
    `조사할 ${k.short}: ${p.name}`,
    p.area ? `${k.subject.area} 힌트: ${p.area}` : "",
    p.link ? `사용자가 준 링크(이 ${k.short}의 소개 페이지일 수 있음): ${p.link}` : "",
    input.kind === "place" && input.memo.visitedOn ? `방문일: ${input.memo.visitedOn}` : "",
    clues.length ? `사진에서 읽은 글자(같은 대상인지 확인하는 단서로만 사용):\n${clues.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 원고·조사 요청에 넣을 사진 분석 요약 */
export function photoNotesText(notes: PhotoNote[] | undefined): string {
  if (!notes?.length) return "";
  return notes
    .map((n) => `- ${n.photoId} [${n.category}] ${n.description}${n.visibleText ? ` (보이는 글자: ${n.visibleText})` : ""} / 설명 초안: ${n.caption}`)
    .join("\n");
}

const LENGTH_GUIDE = { normal: "중간 글(본문 약 1,500~2,000자)", long: "긴 글(본문 약 3,000~3,500자)" } as const;

const fmtDate = (iso?: string) => (iso ? iso.replace("T", " ").slice(0, 16) : "알 수 없음");

/** 사진 앞에 붙이는 설명(사진 ID·촬영 시각·가린 얼굴 수) */
export function photoLabel(p: Job["photos"][number]): string {
  return `사진 ${p.id} (촬영: ${fmtDate(p.takenAt)}${p.faces.length ? `, 얼굴 ${p.faces.length}명 가림` : ""})`;
}

/** 원고 작성 요청 본문(사진 뒤에 붙는 글) */
export function writerContext(job: Job): string {
  const { input, research, styleNote, photoNotes } = job;
  const k = KIND_TEXT[input.kind];
  const memo = memoLines(input.kind, input.memo);
  const styleTitle = input.template
    ? "## 글 템플릿 참고(다른 사람의 블로그 — 구성·말투만 따르고 문장은 베끼지 않음)"
    : "## 블로그 문체 참고(내 블로그)";
  const sections: [string, string][] = [
    ["## 후기 종류", `${k.label} (${input.kind})`],
    [`## ${k.short}`, `${input.place.name}${input.place.area ? ` (${k.subject.area}: ${input.place.area})` : ""}`],
    [
      `## ${k.short} 조사 결과`,
      research ? JSON.stringify({ summary: research.summary, facts: research.facts }, null, 1) : "조사 결과 없음 — 사실 정보는 쓰지 마세요.",
    ],
    [`## ${k.memoTitle}`, memo.length ? memo.join("\n") : "메모 없음 — 경험 평가는 쓰지 말고 사진에 보이는 것만 묘사하세요."],
    ...reviewPointSections(job),
    ["## AI 사진 분석(사진 배치·설명에 활용)", photoNotesText(photoNotes) || "분석 결과 없음 — 사진을 직접 보고 판단하세요."],
    [styleTitle, styleNote || "참고할 글 없음"],
    [
      "## 옵션",
      `길이: ${LENGTH_GUIDE[input.options.length]}\n해시태그 개수: ${input.options.hashtagCount}\n협찬 표기: ${input.options.disclosure || "없음"}`,
    ],
    ["## 사진 ID 목록(모두 한 번씩 사용)", job.photos.map((p) => p.id).join(", ")],
  ];
  return sections.map(([title, body]) => `${title}\n${body}`).join("\n\n");
}

export const fixRequest = (problems: string[]) =>
  `원고에 다음 문제가 있습니다. 고친 전체 원고를 다시 주세요.\n- ${problems.join("\n- ")}`;

/** 원고 JSON을 검증한다. 문제가 있으면 문제 목록을 돌려준다. */
export function parseDraft(text: string, photoIds: string[]): { draft?: PostDraft; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problems: ["JSON 형식이 아닙니다."] };
  }
  const parsed = draftSchema.safeParse(normalizeBlocks(raw));
  if (!parsed.success) return { problems: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) };
  const problems = checkDraft(parsed.data, photoIds);
  return problems.length ? { problems } : { draft: parsed.data, problems };
}

/**
 * 공급자마다 구조화 출력 스키마 표현력이 달라, 블록을 평평한 형태({type, text?, photoId?, caption?})로
 * 받는 경우가 있다. 종류에 맞지 않는 필드를 떼어 내 공용 형식으로 맞춘다.
 */
function normalizeBlocks(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { blocks?: unknown }).blocks)) return raw;
  const r = raw as { blocks: Record<string, unknown>[] };
  return {
    ...r,
    blocks: r.blocks.map((b) =>
      b?.type === "photo" ? { type: "photo", photoId: b.photoId, caption: b.caption ?? "" } : { type: b?.type, text: b?.text },
    ),
  };
}

/** Anthropic 구조화 출력용 JSON 스키마(블록 종류별 anyOf) */
export const DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "titleCandidates", "blocks", "hashtags"],
  properties: {
    title: { type: "string" },
    titleCandidates: { type: "array", items: { type: "string" } },
    hashtags: { type: "array", items: { type: "string" } },
    blocks: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "text"],
            properties: { type: { type: "string", enum: ["heading", "text"] }, text: { type: "string" } },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "photoId", "caption"],
            properties: { type: { type: "string", enum: ["photo"] }, photoId: { type: "string" }, caption: { type: "string" } },
          },
        ],
      },
    },
  },
} as const;

/** 단순한 스키마만 받는 공급자용: 블록을 평평한 객체로 받는다(normalizeBlocks가 정리) */
export const FLAT_DRAFT_JSON_SCHEMA = {
  type: "object",
  required: ["title", "titleCandidates", "blocks", "hashtags"],
  properties: {
    title: { type: "string" },
    titleCandidates: { type: "array", items: { type: "string" } },
    hashtags: { type: "array", items: { type: "string" } },
    blocks: {
      type: "array",
      items: {
        type: "object",
        required: ["type"],
        properties: {
          type: { type: "string", enum: ["heading", "text", "photo"] },
          text: { type: "string", description: "heading·text 블록의 내용" },
          photoId: { type: "string", description: "photo 블록의 사진 ID(예: p1)" },
          caption: { type: "string", description: "photo 블록의 사진 설명 한 문장" },
        },
      },
    },
  },
} as const;

/** 작업 원고에 들어갈 사진 ID 목록 */
export const photoIdsOf = (job: Job) => job.photos.map((p) => p.id);
export type { PostDraft };
