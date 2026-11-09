/**
 * 다른 방문자·사용자 후기 포인트: 조사 결과 검사, 체크 목록 검사(허용 목록), 원고 요청에서 내 경험/남의 후기 구분.
 * 외부 서비스는 부르지 않는다.
 */
import { describe, expect, it } from "vitest";
import { parseResearch, writerContext } from "../../src/lib/ai/shared";
import { cleanReviewPoints, ConfirmedPointsError, keepKnownConfirmed, reviewPointSections, validateConfirmedPoints } from "../../src/lib/jobs/reviewPoints";
import type { Job, ReviewPoint } from "../../src/lib/jobs/types";

const points: ReviewPoint[] = [
  { point: "주말 오후에는 승마 체험 대기가 길다는 후기가 많음", type: "caution", sources: ["https://blog.naver.com/a/1"] },
  { point: "연못 앞 포니 산책로가 사진 찍기 좋다는 평", type: "highlight", sources: [] },
];

const job = (confirmedPoints?: string[]): Job => ({
  id: "77777777-2222-4333-8444-555555555555",
  createdAt: "t",
  updatedAt: "t",
  status: "draft_ready",
  input: {
    kind: "place",
    blogId: "me",
    place: { name: "비스타밸리" },
    memo: {},
    options: { faceMode: "mosaic", length: "normal", hashtagCount: 5, sortByTime: true },
  },
  photos: [{ id: "p1", ext: ".jpg", faces: [], aiWidth: 10 }],
  research: { summary: "s", facts: [], sources: [], reviewPoints: points, checkedAt: "t" },
  ...(confirmedPoints ? { confirmedPoints } : {}),
});

describe("조사 결과의 후기 포인트", () => {
  it("항목별로 걸러 형식이 틀린 것·중복·http가 아닌 주소만 빼고 나머지는 살린다", () => {
    const cleaned = cleanReviewPoints([
      { point: "좋은 포인트", type: "tip", sources: ["https://a.example/1", "javascript:alert(1)", "https://a.example/1"] },
      { point: "좋은 포인트", type: "tip", sources: [] },
      { point: "종류가 이상함", type: "rumor", sources: [] },
      { point: "", type: "tip", sources: [] },
      "문자열",
    ]);
    expect(cleaned).toEqual([{ point: "좋은 포인트", type: "tip", sources: ["https://a.example/1"] }]);
    expect(cleanReviewPoints(undefined)).toEqual([]);
  });
  it("후기 포인트가 일부 틀려도 조사 결과 전체를 버리지 않는다", () => {
    const text = JSON.stringify({ summary: "s", facts: [], sources: [], reviewPoints: [points[0], { point: 1 }] });
    const r = parseResearch(text, "t");
    expect(r.reviewPoints).toEqual([points[0]]);
  });
});

describe("체크 목록 검사", () => {
  it("조사 결과에 있는 문구만 받고, 중복은 하나로 합친다", () => {
    expect(validateConfirmedPoints([points[0]!.point, points[0]!.point], job())).toEqual([points[0]!.point]);
    expect(validateConfirmedPoints([], job())).toEqual([]);
  });
  it("모르는 문구·형식 오류·너무 많은 항목은 거부한다", () => {
    expect(() => validateConfirmedPoints(["지어낸 경험"], job())).toThrow(ConfirmedPointsError);
    expect(() => validateConfirmedPoints("문자열", job())).toThrow(ConfirmedPointsError);
    expect(() => validateConfirmedPoints([1], job())).toThrow(ConfirmedPointsError);
    expect(() => validateConfirmedPoints(Array.from({ length: 13 }, () => points[0]!.point), job())).toThrow(ConfirmedPointsError);
  });
  it("다시 조사하면 새 결과에 없는 체크는 버린다", () => {
    expect(keepKnownConfirmed([points[0]!.point, "사라진 포인트"], points)).toEqual([points[0]!.point]);
    expect(keepKnownConfirmed(undefined, undefined)).toEqual([]);
  });
});

describe("원고 요청: 내 경험과 남의 후기를 구분해 넘긴다", () => {
  it("체크하지 않은 포인트는 '사용자가 겪은 것 아님' 구역에만 들어간다", () => {
    const text = writerContext(job());
    expect(text).toContain("사용자가 겪은 것 아님");
    expect(text).toContain(points[0]!.point);
    expect(text).not.toContain("사용자가 직접 겪었다고 확인한 내용");
  });
  it("체크한 포인트는 1인칭 경험 구역으로 옮긴다", () => {
    const sections = reviewPointSections(job([points[0]!.point]));
    expect(sections).toHaveLength(2);
    expect(sections[0]![0]).toContain("직접 겪었다고 확인한");
    expect(sections[0]![1]).toContain(points[0]!.point);
    expect(sections[1]![1]).not.toContain(points[0]!.point);
    expect(sections[1]![1]).toContain(points[1]!.point);
  });
  it("포인트가 없으면 구역을 만들지 않는다", () => {
    expect(reviewPointSections({ research: { summary: "", facts: [], sources: [], checkedAt: "t" } })).toEqual([]);
  });
});
