/**
 * 다른 방문자·사용자 후기에서 모은 포인트 처리.
 * 원칙: 남의 경험을 사용자의 경험으로 쓰지 않는다(독자를 속이는 후기가 됨).
 * - 사용자가 체크한 포인트만 1인칭 경험으로 쓴다.
 * - 체크하지 않은 포인트는 "후기를 보니 ~라고 해요" 같은 정보·팁으로만 쓴다.
 * 서버·화면 공용이라 Node 모듈을 쓰지 않는다.
 */
import { MAX_REVIEW_POINTS, reviewPointSchema, type Job, type ReviewPoint } from "./types";

export const REVIEW_POINT_LABELS: Record<ReviewPoint["type"], string> = {
  highlight: "좋았다는 점",
  tip: "팁",
  caution: "아쉬운 점",
};

/** AI 응답의 reviewPoints를 항목별로 검사해 맞는 것만 남긴다(하나가 틀려도 나머지는 살림). 같은 문구는 하나만 */
export function cleanReviewPoints(raw: unknown): ReviewPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviewPoint[] = [];
  for (const item of raw) {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const sources = Array.isArray(r.sources) ? r.sources.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)) : [];
    const parsed = reviewPointSchema.safeParse({ ...r, sources: [...new Set(sources)].slice(0, 5) });
    if (parsed.success && !out.some((p) => p.point === parsed.data.point)) out.push(parsed.data);
    if (out.length >= MAX_REVIEW_POINTS) break;
  }
  return out;
}

export class ConfirmedPointsError extends Error {
  override name = "ConfirmedPointsError";
}

/** 화면에서 보낸 체크 목록 검사: 지금 조사 결과에 있는 포인트 문구만 받는다(허용 목록) */
export function validateConfirmedPoints(value: unknown, job: Pick<Job, "research">): string[] {
  if (!Array.isArray(value) || value.length > MAX_REVIEW_POINTS || !value.every((v) => typeof v === "string")) {
    throw new ConfirmedPointsError("체크한 후기 포인트 형식이 올바르지 않습니다.");
  }
  const known = new Set(job.research?.reviewPoints?.map((p) => p.point) ?? []);
  const unknown = value.filter((v) => !known.has(v));
  if (unknown.length) throw new ConfirmedPointsError("조사 결과에 없는 후기 포인트가 있습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.");
  return [...new Set(value as string[])];
}

/** 새로 조사한 포인트에 없는 체크는 버린다(처음부터 다시 만들 때) */
export function keepKnownConfirmed(confirmed: string[] | undefined, points: ReviewPoint[] | undefined): string[] {
  const known = new Set(points?.map((p) => p.point) ?? []);
  return (confirmed ?? []).filter((c) => known.has(c));
}

/** 원고 작성 요청에 넣을 두 구역(사용자 확인 / 남의 후기). 포인트가 없으면 빈 배열 */
export function reviewPointSections(job: Pick<Job, "research" | "confirmedPoints">): [string, string][] {
  const points = job.research?.reviewPoints ?? [];
  if (!points.length) return [];
  const confirmed = new Set(job.confirmedPoints ?? []);
  const line = (p: ReviewPoint) => `- [${REVIEW_POINT_LABELS[p.type]}] ${p.point}`;
  const mine = points.filter((p) => confirmed.has(p.point));
  const others = points.filter((p) => !confirmed.has(p.point));
  const out: [string, string][] = [];
  if (mine.length) out.push(["## 사용자가 직접 겪었다고 확인한 내용(1인칭 경험으로 써도 됨)", mine.map(line).join("\n")]);
  if (others.length) {
    out.push([
      "## 다른 방문자·사용자 후기에서 자주 나온 내용(사용자가 겪은 것 아님 — 정보·팁으로만)",
      others.map(line).join("\n"),
    ]);
  }
  return out;
}
