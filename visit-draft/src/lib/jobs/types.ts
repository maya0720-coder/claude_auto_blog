/**
 * 후기 작업(Job)의 데이터 구조. 서버와 화면이 함께 쓰므로 Node 전용 모듈을 가져오지 않는다.
 * AI 출력은 반드시 여기 정의한 zod 스키마로 검증한다(CLAUDE.md).
 */
import { z } from "zod";
import { FACE_MODES } from "../config/schema";

const text = (max: number) => z.string().trim().max(max);

/** 글 길이: 중간 글, 긴 글. 예전 작업의 "short"는 중간 글로 읽는다 */
export const LENGTHS = ["normal", "long"] as const;
const lengthSchema = z.preprocess((v) => (v === "short" ? "normal" : v), z.enum(LENGTHS));

/** 후기 종류: 장소 방문 후기, 제품 사용 후기 */
export const REVIEW_KINDS = ["place", "product"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** 참고할 다른 네이버 블로그(블로그 전체 또는 글 한 편). 서버가 주소를 해석해 만든 값만 저장한다 */
export const templateRefSchema = z.object({
  blogId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  logNo: z.string().regex(/^\d{1,20}$/).optional(),
});

export const visitMemoSchema = z.object({
  visitedOn: text(20).optional(),
  companions: text(100).optional(),
  ordered: text(500).optional(),
  good: text(1000).optional(),
  bad: text(1000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  free: text(2000).optional(),
});

export const jobInputSchema = z.object({
  /** 예전 작업에는 없으므로 장소 후기로 본다 */
  kind: z.enum(REVIEW_KINDS).default("place"),
  blogId: z.string().min(1).max(40),
  categoryNo: z.string().regex(/^\d{1,10}$/).optional(),
  /**
   * 후기 대상. 장소 후기면 장소(이름·링크·지역), 제품 후기면 제품(이름·링크·브랜드)이다.
   * 저장된 예전 작업과 호환되도록 필드 이름은 place를 그대로 쓴다.
   */
  place: z.object({
    name: text(100).min(1, "후기 대상의 이름을 입력해 주세요."),
    link: z
      .string()
      .trim()
      .max(500)
      .refine((u) => /^https?:\/\/[^\s]+$/i.test(u), "링크는 http(s) 주소만 넣을 수 있습니다.")
      .optional(),
    area: text(100).optional(),
  }),
  memo: visitMemoSchema,
  /** 있으면 내 블로그 대신 이 블로그의 글 구성·말투를 참고한다 */
  template: templateRefSchema.optional(),
  options: z.object({
    faceMode: z.enum(FACE_MODES),
    length: lengthSchema,
    hashtagCount: z.number().int().min(0).max(30),
    disclosure: text(200).optional(),
    sortByTime: z.boolean(),
  }),
});

const faceBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  score: z.number(),
});

export const photoSchema = z.object({
  id: z.string().regex(/^p\d{1,3}$/),
  ext: z.string().regex(/^\.[a-z0-9]+$/),
  takenAt: z.string().optional(),
  /** AI용 사본 기준 얼굴 상자. 가리기 방식을 바꿀 때 다시 찾지 않고 쓴다 */
  faces: z.array(faceBoxSchema).max(200),
  aiWidth: z.number().int().positive(),
});

/** AI 사진 분석 결과(사진 한 장당 하나). 원고 작성 전에 만들고 화면에도 보여 준다 */
export const photoNoteSchema = z.object({
  photoId: z.string().regex(/^p\d{1,3}$/),
  category: z.string().trim().min(1).max(30),
  description: z.string().trim().min(1).max(400),
  visibleText: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(120),
});

export const researchSchema = z.object({
  summary: z.string().max(4000),
  facts: z
    .array(z.object({ label: z.string().max(50), value: z.string().max(500), source: z.string().max(500).optional() }))
    .max(30),
  sources: z.array(z.string().max(500)).max(30),
  checkedAt: z.string(),
});

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().min(1).max(200) }),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(3000) }),
  z.object({ type: z.literal("photo"), photoId: z.string().regex(/^p\d{1,3}$/), caption: z.string().max(300) }),
]);

export const draftSchema = z.object({
  title: z.string().min(1).max(100),
  titleCandidates: z.array(z.string().min(1).max(100)).max(5),
  blocks: z.array(blockSchema).min(1).max(200),
  hashtags: z.array(z.string().min(1).max(30)).max(30),
});

export const JOB_STATUSES = ["processing", "draft_ready", "saving", "saved", "failed"] as const;

export const jobSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(JOB_STATUSES),
  input: jobInputSchema,
  photos: z.array(photoSchema),
  photoNotes: z.array(photoNoteSchema).max(50).optional(),
  research: researchSchema.optional(),
  styleNote: z.string().max(10000).optional(),
  draft: draftSchema.optional(),
  error: z.string().max(500).optional(),
  saved: z.object({ at: z.string(), confirmed: z.boolean(), screenshot: z.string().optional() }).optional(),
});

export type VisitMemo = z.infer<typeof visitMemoSchema>;
export type JobInput = z.infer<typeof jobInputSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type PhotoNote = z.infer<typeof photoNoteSchema>;
export type TemplateRef = z.infer<typeof templateRefSchema>;
export type PlaceResearch = z.infer<typeof researchSchema>;
export type DraftBlock = z.infer<typeof blockSchema>;
export type PostDraft = z.infer<typeof draftSchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** 목록 화면용 요약 */
export interface JobSummary {
  id: string;
  createdAt: string;
  status: JobStatus;
  kind: ReviewKind;
  placeName: string;
  title?: string;
  photoCount: number;
}

/** 작업 진행 단계(화면 표시용) */
export const GENERATE_STEPS = ["photos", "analyze", "style", "research", "write"] as const;
export const SAVE_STEPS = ["login", "editor", "content", "save"] as const;
export type JobStep = (typeof GENERATE_STEPS)[number] | (typeof SAVE_STEPS)[number];

/**
 * 협찬 표기는 법적 고지이므로 AI에 맡기지 않고 코드로 보장한다: 본문 어디에도 없으면 맨 앞에 넣는다.
 */
export function ensureDisclosure(draft: PostDraft, disclosure: string | undefined): PostDraft {
  const text = disclosure?.trim();
  if (!text) return draft;
  const present = draft.blocks.some((b) => b.type !== "photo" && b.text.includes(text));
  return present ? draft : { ...draft, blocks: [{ type: "text", text }, ...draft.blocks] };
}

/** 원고를 그대로 복사해 붙여 넣을 수 있는 글로 만든다(자동 저장이 안 될 때 대체 수단). */
export function draftToPlainText(draft: PostDraft): string {
  const parts = draft.blocks.map((b) => (b.type === "photo" ? `[사진 ${b.photoId}] ${b.caption}` : b.text));
  const tags = draft.hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
  return [draft.title, "", ...parts.flatMap((p) => [p, ""]), tags].join("\n").trim();
}

/** 사진 블록이 모든 사진을 쓰는지 등 원고 정합성 검사. 문제 목록을 돌려준다. */
export function checkDraft(draft: PostDraft, photoIds: string[]): string[] {
  const problems: string[] = [];
  const used = draft.blocks.flatMap((b) => (b.type === "photo" ? [b.photoId] : []));
  const unknown = used.filter((id) => !photoIds.includes(id));
  if (unknown.length) problems.push(`없는 사진을 가리킵니다: ${[...new Set(unknown)].join(", ")}`);
  const dup = used.filter((id, i) => used.indexOf(id) !== i);
  if (dup.length) problems.push(`같은 사진이 두 번 이상 들어 있습니다: ${[...new Set(dup)].join(", ")}`);
  const missing = photoIds.filter((id) => !used.includes(id));
  if (missing.length) problems.push(`빠진 사진이 있습니다: ${missing.join(", ")}`);
  return problems;
}
