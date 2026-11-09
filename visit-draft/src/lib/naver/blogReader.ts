import { fillTemplate } from "../config/load";
import type { Defaults } from "../config/schema";
import { errorSummary, politeDelay } from "../util/common";
import { parseRss, type RssPost } from "./rss";
import {
  computeLayoutStats,
  extractLegacyText,
  parseSmartEditor,
  renderExcerpt,
  type BlogSelectors,
  type LayoutStats,
} from "./seParser";

export class BlogReadError extends Error {
  override name = "BlogReadError";
}

export interface ReadPostsResult {
  rssItemCount: number;
  rssSkipped: number;
  /** RSS 항목에 카테고리 이름이 들어 있는지(U3) */
  rssHasCategory: boolean;
  categoriesSeen: string[];
  fetched: number;
  parsedOk: number;
  legacyOrUnknown: number;
  failures: string[];
  stats: LayoutStats;
  /** 문체 참고용 발췌(최근 글부터). 구 에디터 글은 텍스트만 */
  excerpts: string[];
}

/** 발췌 옵션. 생략하면 발췌를 만들지 않는다 */
export interface ExcerptOptions {
  maxPosts: number;
  maxChars: number;
}

/**
 * 주소의 본문을 받아 오는 최소 인터페이스. 실제 앱은 브라우저 창(pageFetcher.ts),
 * PoC는 Playwright APIRequestContext, 테스트는 가짜 객체를 넘긴다.
 */
export interface HttpGetter {
  get(url: string, opts: { timeout: number; maxRedirects: number }): Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>;
}

async function getText(request: HttpGetter, url: string, timeoutMs: number): Promise<string> {
  const res = await request.get(url, { timeout: timeoutMs, maxRedirects: 3 });
  if (!res.ok()) throw new BlogReadError(`HTTP ${res.status()}`);
  return res.text();
}

/**
 * 공개 글을 RSS → 모바일 본문 순서로 읽어 정량 지표를 계산한다(설계서 F5, 9.2장).
 * 두 경로 모두 비공식이므로 PoC에서 동작을 확인한다. 요청 사이에는 1~3초를 둔다.
 */
export async function readRecentPosts(
  request: HttpGetter,
  blogId: string,
  count: number,
  sel: BlogSelectors,
  reader: Defaults["reader"],
  timeoutMs: number,
  excerpt: ExcerptOptions = { maxPosts: 0, maxChars: 0 },
): Promise<ReadPostsResult> {
  const xml = await getText(request, fillTemplate(sel.rssUrl, { blogId }), timeoutMs);
  const { posts, skipped } = parseRss(xml, blogId, sel.allowedHosts);
  const targets: RssPost[] = posts.slice(0, Math.min(count, reader.maxPostCount));

  const parsedBlocks = [];
  const failures: string[] = [];
  const excerpts: string[] = [];
  const wantExcerpt = () => excerpts.length < excerpt.maxPosts;
  let legacy = 0;
  for (const [i, post] of targets.entries()) {
    await politeDelay(reader.minIntervalMs, reader.maxIntervalMs);
    try {
      const html = await getText(request, fillTemplate(sel.postUrl, { blogId, logNo: post.logNo }), timeoutMs);
      const parsed = parseSmartEditor(html, sel);
      if (parsed.legacyOrUnknown) {
        legacy += 1;
        const text = wantExcerpt() ? extractLegacyText(html, sel, excerpt.maxChars) : "";
        if (text) excerpts.push(text);
      } else {
        parsedBlocks.push(parsed.blocks);
        if (wantExcerpt()) excerpts.push(renderExcerpt(parsed.blocks, excerpt.maxChars));
      }
    } catch (err) {
      failures.push(`글 ${i + 1}: ${errorSummary(err)}`);
    }
  }

  const categories = [...new Set(posts.map((p) => p.category).filter((c): c is string => !!c))];
  return {
    rssItemCount: posts.length + skipped,
    rssSkipped: skipped,
    rssHasCategory: categories.length > 0,
    categoriesSeen: categories,
    fetched: targets.length,
    parsedOk: parsedBlocks.length,
    legacyOrUnknown: legacy,
    failures,
    stats: computeLayoutStats(parsedBlocks),
    excerpts,
  };
}

/** 글 한 편만 읽는다(참고 블로그 주소가 특정 글일 때). 지표·발췌는 readRecentPosts와 같은 형식 */
export async function readSinglePost(
  request: HttpGetter,
  blogId: string,
  logNo: string,
  sel: BlogSelectors,
  timeoutMs: number,
  maxChars: number,
): Promise<ReadPostsResult> {
  const html = await getText(request, fillTemplate(sel.postUrl, { blogId, logNo }), timeoutMs);
  const parsed = parseSmartEditor(html, sel);
  const legacy = parsed.legacyOrUnknown;
  const excerpt = legacy ? extractLegacyText(html, sel, maxChars) : renderExcerpt(parsed.blocks, maxChars);
  if (!excerpt) throw new BlogReadError("글 본문을 찾지 못했습니다(비공개 글이거나 지원하지 않는 형식).");
  return {
    rssItemCount: 0,
    rssSkipped: 0,
    rssHasCategory: false,
    categoriesSeen: [],
    fetched: 1,
    parsedOk: legacy ? 0 : 1,
    legacyOrUnknown: legacy ? 1 : 0,
    failures: [],
    stats: computeLayoutStats(legacy ? [] : [parsed.blocks]),
    excerpts: [excerpt],
  };
}
