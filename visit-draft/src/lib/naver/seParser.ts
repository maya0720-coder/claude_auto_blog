import * as cheerio from "cheerio";
import type { Selectors } from "../config/schema";

export type BlogSelectors = Selectors["blog"];

export interface ParsedBlock {
  /** blockClasses의 키(text, image, heading 등). 알 수 없는 블록은 "other" */
  type: string;
  text?: string;
  imageCount?: number;
}

export interface ParsedPost {
  /** 스마트에디터 ONE 본문 컨테이너가 없으면 true (구 에디터 글 또는 화면 구조 변경) */
  legacyOrUnknown: boolean;
  blocks: ParsedBlock[];
}

const TEXT_TYPES = new Set(["text", "heading", "quote"]);
const IMAGE_TYPES = new Set(["image", "imageStrip"]);

/** 스마트에디터 ONE 글 HTML을 블록 배열로 바꾼다(설계서 9.2장). */
export function parseSmartEditor(html: string, sel: BlogSelectors): ParsedPost {
  const $ = cheerio.load(html);
  const container = $(sel.container).first();
  if (container.length === 0) return { legacyOrUnknown: true, blocks: [] };

  // 블록 종류 판정 순서: 설정 파일에 적힌 순서를 따른다(예: se-sectionTitle을 se-text보다 먼저)
  const classEntries = Object.entries(sel.blockClasses);
  const blocks: ParsedBlock[] = [];

  container.find(sel.component).each((_, el) => {
    const node = $(el);
    // 중첩된 컴포넌트는 바깥 컴포넌트에서 이미 셌으므로 건너뛴다
    if (node.parents(sel.component).length > 0) return;
    const classes = (node.attr("class") ?? "").split(/\s+/);
    const type = classEntries.find(([, cls]) => classes.includes(cls))?.[0] ?? "other";
    const block: ParsedBlock = { type };
    if (TEXT_TYPES.has(type)) {
      block.text = node
        .find(sel.paragraph)
        .map((__, p) => $(p).text().replace(/​/g, "").trim())
        .get()
        .filter((t) => t.length > 0)
        .join("\n");
    }
    if (IMAGE_TYPES.has(type)) block.imageCount = Math.max(1, node.find("img").length);
    blocks.push(block);
  });

  return { legacyOrUnknown: false, blocks };
}

const BLOCK_LABEL: Record<string, string> = {
  heading: "[소제목] ",
  quote: "[인용] ",
  divider: "[구분선]",
  map: "[지도]",
  sticker: "[스티커]",
  link: "[링크]",
};

/** 문체·구성 참고용 발췌: 블록 순서가 보이도록 사진 자리를 [사진 n장]으로 표시한다. */
export function renderExcerpt(blocks: ParsedBlock[], maxChars: number): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === "image" || b.type === "imageStrip") lines.push(`[사진 ${b.imageCount ?? 1}장]`);
    else if (b.text) lines.push(`${BLOCK_LABEL[b.type] ?? ""}${b.text}`);
    else if (BLOCK_LABEL[b.type]) lines.push(BLOCK_LABEL[b.type]!);
  }
  const joined = lines.join("\n");
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}…` : joined;
}

/** 구 에디터 글 등 블록 구조를 모를 때: 본문 텍스트만 뽑는다. 찾지 못하면 빈 문자열. */
export function extractLegacyText(html: string, sel: BlogSelectors, maxChars: number): string {
  const $ = cheerio.load(html);
  for (const css of sel.legacyContainers) {
    const node = $(css).first();
    if (node.length === 0) continue;
    node.find("script, style").remove();
    node.find("img").replaceWith("\n[사진]\n");
    node.find("br, p, div").after("\n");
    const text = node
      .text()
      .replace(/​/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l, i, arr) => !(l === "[사진]" && arr[i - 1] === "[사진]")) // 연속 사진은 한 줄로
      .join("\n");
    if (text.length > 0) return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  }
  return "";
}

export interface LayoutStats {
  postCount: number;
  avgBlocksPerPost: number;
  avgImagesPerPost: number;
  avgParagraphChars: number;
  maxConsecutiveImages: number;
  imageTextRatio: number;
  uses: Record<"heading" | "quote" | "divider" | "map" | "sticker", boolean>;
  /** 첫 글의 블록 순서(연속 중복 제거). 패턴 확인용 */
  sampleSequence: string[];
}

/** 여러 글의 블록에서 정량 지표를 계산한다(설계서 F5 정량 분석). */
export function computeLayoutStats(posts: ParsedBlock[][]): LayoutStats {
  let blockTotal = 0;
  let imageTotal = 0;
  let textBlockTotal = 0;
  let paragraphChars = 0;
  let paragraphCount = 0;
  let maxConsecutiveImages = 0;
  const seen = new Set<string>();

  for (const blocks of posts) {
    let run = 0;
    for (const b of blocks) {
      blockTotal += 1;
      seen.add(b.type);
      if (IMAGE_TYPES.has(b.type)) {
        const n = b.imageCount ?? 1;
        imageTotal += n;
        run += n;
        maxConsecutiveImages = Math.max(maxConsecutiveImages, run);
        continue;
      }
      run = 0;
      if (b.text) {
        textBlockTotal += 1;
        for (const line of b.text.split("\n")) {
          paragraphChars += line.length;
          paragraphCount += 1;
        }
      }
    }
  }

  const n = posts.length;
  const round = (v: number) => Math.round(v * 10) / 10;
  const sampleSequence = (posts[0] ?? []).map((b) => b.type).filter((t, i, arr) => t !== arr[i - 1]);

  return {
    postCount: n,
    avgBlocksPerPost: n ? round(blockTotal / n) : 0,
    avgImagesPerPost: n ? round(imageTotal / n) : 0,
    avgParagraphChars: paragraphCount ? round(paragraphChars / paragraphCount) : 0,
    maxConsecutiveImages,
    imageTextRatio: textBlockTotal ? round(imageTotal / textBlockTotal) : 0,
    uses: {
      heading: seen.has("heading"),
      quote: seen.has("quote"),
      divider: seen.has("divider"),
      map: seen.has("map"),
      sticker: seen.has("sticker"),
    },
    sampleSequence,
  };
}
