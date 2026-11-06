import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadSelectors } from "../../src/lib/config/load";
import { sortByTakenAt } from "../../src/lib/images/process";
import { applyFaceMask, expandBox, scaleBox } from "../../src/lib/images/mask";
import { extractLegacyText, renderExcerpt, type ParsedBlock } from "../../src/lib/naver/seParser";
import { formatStyleNote } from "../../src/lib/naver/styleNote";
import { computeLayoutStats } from "../../src/lib/naver/seParser";

const sel = loadSelectors();
const opts = { padding: 0, mosaicCells: 4 };

/** 왼쪽 절반 빨강, 오른쪽 절반 파랑인 100x100 이미지 */
async function halves(): Promise<Buffer> {
  const left = await sharp({ create: { width: 50, height: 100, channels: 3, background: "#f00" } }).png().toBuffer();
  return sharp({ create: { width: 100, height: 100, channels: 3, background: "#00f" } })
    .composite([{ input: left, left: 0, top: 0 }])
    .png()
    .toBuffer();
}
const pixel = async (img: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};

describe("expandBox / scaleBox", () => {
  it("사진 밖으로 나가지 않게 자른다", () => {
    expect(expandBox({ x: -10, y: 90, width: 30, height: 30, score: 1 }, 0, 100, 100)).toEqual({ left: 0, top: 90, width: 20, height: 10 });
    expect(expandBox({ x: 200, y: 200, width: 10, height: 10, score: 1 }, 0, 100, 100)).toBeUndefined();
  });
  it("여유 비율만큼 넓히고, 크기 비율로 바꾼다", () => {
    expect(expandBox({ x: 40, y: 40, width: 20, height: 20, score: 1 }, 0.5, 100, 100)).toEqual({ left: 30, top: 30, width: 40, height: 40 });
    expect(scaleBox({ x: 1, y: 2, width: 3, height: 4, score: 0.5 }, 2)).toEqual({ x: 2, y: 4, width: 6, height: 8, score: 0.5 });
  });
});

describe("applyFaceMask", () => {
  it("모자이크는 얼굴 영역만 바꾸고 나머지는 그대로 둔다", async () => {
    const img = await halves();
    // 빨강·파랑 경계를 걸친 영역을 모자이크하면 그 안의 색이 섞인다
    const out = await applyFaceMask(img, [{ x: 30, y: 30, width: 40, height: 40, score: 1 }], "mosaic", opts);
    expect(await pixel(out, 5, 5)).toEqual([255, 0, 0]);
    expect(await pixel(out, 95, 95)).toEqual([0, 0, 255]);
    const inside = await pixel(out, 49, 50);
    expect(inside).not.toEqual([255, 0, 0]);
  });
  it("스티커는 얼굴 위에 노란 얼굴을 얹는다", async () => {
    const img = await halves();
    const out = await applyFaceMask(img, [{ x: 25, y: 25, width: 50, height: 50, score: 1 }], "sticker", opts);
    const [r, g, b] = await pixel(out, 50, 30);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeLessThan(120);
  });
  it("가리지 않음·얼굴 없음이면 입력을 그대로 돌려준다", async () => {
    const img = await halves();
    expect(await applyFaceMask(img, [{ x: 1, y: 1, width: 5, height: 5, score: 1 }], "none", opts)).toBe(img);
    expect(await applyFaceMask(img, [], "mosaic", opts)).toBe(img);
  });
});

describe("sortByTakenAt", () => {
  it("촬영 시각 순, 시각 없는 사진은 원래 순서로 뒤에", () => {
    const p = (id: string, takenAt?: string) => ({ id, ext: ".jpg", faces: [], aiWidth: 1, ...(takenAt ? { takenAt } : {}) });
    expect(sortByTakenAt([p("p1", "2026-01-02"), p("p2"), p("p3", "2026-01-01"), p("p4")]).map((x) => x.id)).toEqual(["p3", "p1", "p2", "p4"]);
  });
});

describe("문체 참고 발췌", () => {
  const blocks: ParsedBlock[] = [
    { type: "heading", text: "📍 위치" },
    { type: "text", text: "안녕하세요~" },
    { type: "imageStrip", imageCount: 2 },
    { type: "divider" },
  ];
  it("블록 순서와 사진 자리를 보여 준다", () => {
    expect(renderExcerpt(blocks, 1000)).toBe("[소제목] 📍 위치\n안녕하세요~\n[사진 2장]\n[구분선]");
    expect(renderExcerpt(blocks, 5)).toBe("[소제목]…");
  });
  it("구 에디터 글은 본문 텍스트만 뽑는다", () => {
    const html = `<div id="postViewArea"><p>첫 줄</p><img src="a.jpg"><img src="b.jpg"><p>둘째 줄</p><script>x()</script></div>`;
    expect(extractLegacyText(html, sel.blog, 1000)).toBe("첫 줄\n[사진]\n둘째 줄");
    expect(extractLegacyText("<div>없음</div>", sel.blog, 1000)).toBe("");
  });
  it("지표와 발췌를 한 글로 정리한다", () => {
    const note = formatStyleNote({ stats: computeLayoutStats([blocks]), excerpts: ["발췌 A"], parsedOk: 1, legacyOrUnknown: 2 });
    expect(note).toContain("블록 구조 1편, 텍스트만 2편");
    expect(note).toContain("소제목");
    expect(note).toContain("### 참고 글 1\n발췌 A");
  });
});
