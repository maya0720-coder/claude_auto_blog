/**
 * AI 사진 분석(원고 작성 전 단계): 얼굴 가린 AI용 사본을 보고 사진마다 종류·설명·보이는 글자·설명 문구 초안을 만든다.
 * 공급자와 상관없는 부분(요청 문구, 스키마, 결과 검증)만 둔다.
 */
import { z } from "zod";
import { KIND_TEXT } from "../jobs/reviewKinds";
import { photoNoteSchema, type Job, type PhotoNote } from "../jobs/types";
import { AiError } from "./shared";

export function analyzeUserPrompt(job: Job): string {
  const k = KIND_TEXT[job.input.kind];
  return [
    `후기 종류: ${k.label}`,
    `${k.subject.name}: ${job.input.place.name}${job.input.place.area ? ` (${k.subject.area}: ${job.input.place.area})` : ""}`,
    `사진 ID 목록(모두 한 번씩 분석): ${job.photos.map((p) => p.id).join(", ")}`,
  ].join("\n");
}

/** 구조화 출력용 JSON 스키마(두 공급자 공용, 단순한 형태만 사용) */
export const PHOTO_NOTES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photos"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["photoId", "category", "description", "visibleText", "caption"],
        properties: {
          photoId: { type: "string", description: "사진 ID(예: p1)" },
          category: { type: "string", description: "사진 종류를 짧게(예: 외관, 실내, 음식, 메뉴판, 제품 전체, 디테일, 사용 장면, 구성품, 풍경)" },
          description: { type: "string", description: "사진에 실제로 보이는 것을 1~2문장으로" },
          visibleText: { type: "string", description: "사진 속에서 읽을 수 있는 글자(간판·메뉴·라벨). 없으면 빈 문자열" },
          caption: { type: "string", description: "블로그 사진 설명으로 쓸 짧은 한 문장" },
        },
      },
    },
  },
} as const;

const responseSchema = z.object({ photos: z.array(z.unknown()).max(100) });

/** 응답을 검증한다. 모르는 사진 ID·형식이 틀린 항목은 버리고, 하나도 없으면 오류 */
export function parsePhotoNotes(text: string, photoIds: string[]): PhotoNote[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AiError("사진 분석 결과를 읽지 못했습니다.");
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new AiError("사진 분석 결과 형식이 올바르지 않습니다.");
  const seen = new Set<string>();
  const notes: PhotoNote[] = [];
  for (const item of parsed.data.photos) {
    const rec = item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : {};
    if (rec.visibleText === "") delete rec.visibleText;
    const n = photoNoteSchema.safeParse(rec);
    if (!n.success || !photoIds.includes(n.data.photoId) || seen.has(n.data.photoId)) continue;
    seen.add(n.data.photoId);
    notes.push(n.data);
  }
  if (notes.length === 0) throw new AiError("사진 분석 결과가 비어 있습니다.");
  return notes.sort((a, b) => photoIds.indexOf(a.photoId) - photoIds.indexOf(b.photoId));
}
