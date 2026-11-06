import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSelectors } from "../../src/lib/config/load";
import { parseRss } from "../../src/lib/naver/rss";
import { computeLayoutStats, parseSmartEditor } from "../../src/lib/naver/seParser";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "../fixtures", name), "utf8");
const sel = loadSelectors();

describe("parseRss", () => {
  it("해당 블로그 글만 logNo와 함께 뽑는다", () => {
    const { posts, skipped } = parseRss(fixture("rss.xml"), "test_blog", sel.blog.allowedHosts);
    expect(posts).toEqual([
      {
        logNo: "223000000001",
        title: "성수동 카페 방문기",
        category: "카페",
        pubDate: "Mon, 02 Nov 2026 10:00:00 +0900",
      },
      { logNo: "223000000002", title: "맛집 후기", pubDate: "Sun, 01 Nov 2026 10:00:00 +0900" },
    ]);
    expect(skipped).toBe(2); // 다른 블로그 글, 외부 링크
  });

  it("형식이 맞지 않으면 빈 목록", () => {
    expect(parseRss("<html></html>", "test_blog", sel.blog.allowedHosts)).toEqual({ posts: [], skipped: 0 });
  });

  it("항목이 하나여도 배열로 처리한다", () => {
    const xml = `<rss><channel><item><title>a</title><link>https://blog.naver.com/test_blog/1</link></item></channel></rss>`;
    expect(parseRss(xml, "test_blog", sel.blog.allowedHosts).posts).toHaveLength(1);
  });
});

describe("parseSmartEditor", () => {
  it("블록 종류와 텍스트를 뽑는다", () => {
    const { legacyOrUnknown, blocks } = parseSmartEditor(fixture("se-post.html"), sel.blog);
    expect(legacyOrUnknown).toBe(false);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "text",
      "image",
      "imageStrip",
      "quote",
      "divider",
      "map",
      "other",
    ]);
    expect(blocks[1]?.text).toBe("안녕하세요~ 오늘은 카페에 다녀왔어요.\n분위기가 좋았어요.");
    expect(blocks[3]?.imageCount).toBe(2);
  });

  it("본문 컨테이너가 없으면 legacyOrUnknown", () => {
    expect(parseSmartEditor("<div>old editor</div>", sel.blog)).toEqual({ legacyOrUnknown: true, blocks: [] });
  });
});

describe("computeLayoutStats", () => {
  it("정량 지표를 계산한다", () => {
    const { blocks } = parseSmartEditor(fixture("se-post.html"), sel.blog);
    const stats = computeLayoutStats([blocks]);
    expect(stats.postCount).toBe(1);
    expect(stats.avgImagesPerPost).toBe(3);
    expect(stats.maxConsecutiveImages).toBe(3);
    expect(stats.uses).toEqual({ heading: true, quote: true, divider: true, map: true, sticker: false });
    expect(stats.sampleSequence[0]).toBe("heading");
  });

  it("글이 없으면 0으로 채운다", () => {
    const stats = computeLayoutStats([]);
    expect(stats.postCount).toBe(0);
    expect(stats.avgParagraphChars).toBe(0);
    expect(stats.sampleSequence).toEqual([]);
  });
});
