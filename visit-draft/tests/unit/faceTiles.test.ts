import { describe, expect, it } from "vitest";
import { mergeBoxes, tileRects } from "../../src/lib/images/faceTiles";

const box = (x: number, y: number, s: number, score = 0.9) => ({ x, y, width: s, height: s, score });

describe("tileRects", () => {
  it("항상 전체 사진을 먼저 본다", () => {
    expect(tileRects(300, 300)[0]).toEqual({ left: 0, top: 0, width: 300, height: 300 });
  });
  it("가로로 긴 사진은 정사각형 조각으로 끝까지 덮는다", () => {
    const rects = tileRects(1024, 256);
    const squares = rects.filter((r) => r.width === 256 && r.height === 256);
    expect(squares.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...squares.map((r) => r.left + r.width))).toBe(1024);
  });
  it("큰 사진은 작은 얼굴용 격자를 더하고, 모든 조각은 사진 안에 있다", () => {
    const rects = tileRects(1568, 1176);
    expect(rects.length).toBeGreaterThan(4);
    for (const r of rects) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(1568);
      expect(r.top + r.height).toBeLessThanOrEqual(1176);
    }
  });
});

describe("mergeBoxes", () => {
  it("같은 얼굴을 여러 조각에서 찾으면 점수 높은 하나만 남긴다", () => {
    const merged = mergeBoxes([box(100, 100, 50, 0.7), box(104, 102, 48, 0.95), box(300, 100, 50)]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.score).toBe(0.95);
  });
  it("조각 경계에서 잘린 작은 상자가 큰 상자 안에 있으면 버린다", () => {
    expect(mergeBoxes([box(100, 100, 100, 0.9), { x: 110, y: 120, width: 40, height: 60, score: 0.95 }])).toHaveLength(1);
  });
  it("떨어진 얼굴은 모두 남긴다", () => {
    expect(mergeBoxes([box(0, 0, 10), box(20, 0, 10), box(40, 0, 10)])).toHaveLength(3);
  });
});
