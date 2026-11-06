import { XMLParser } from "fast-xml-parser";
import { resolveBlogUrl } from "./blogUrl";

export interface RssPost {
  logNo: string;
  title: string;
  category?: string;
  pubDate?: string;
}

export interface RssParseResult {
  posts: RssPost[];
  /** logNo를 얻지 못해 건너뛴 항목 수 */
  skipped: number;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  processEntities: true,
  // 외부 엔티티·DOCTYPE 확장을 쓰지 않는다(XXE 방지는 fast-xml-parser 기본 동작)
  htmlEntities: true,
  parseTagValue: false,
});

function asText(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

/** 네이버 블로그 RSS XML에서 글 목록을 뽑는다. 형식이 맞지 않으면 빈 목록을 돌려준다. */
export function parseRss(xml: string, blogId: string, allowedHosts: readonly string[]): RssParseResult {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const rawItems = doc.rss?.channel?.item;
  const items: unknown[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  const posts: RssPost[] = [];
  let skipped = 0;
  for (const item of items) {
    const rec = (item ?? {}) as Record<string, unknown>;
    const link = asText(rec.link) ?? asText(rec.guid);
    let logNo: string | undefined;
    try {
      const ref = link ? resolveBlogUrl(link, allowedHosts) : undefined;
      if (ref && ref.blogId.toLowerCase() === blogId.toLowerCase()) logNo = ref.logNo;
    } catch {
      logNo = undefined;
    }
    if (!logNo) {
      skipped += 1;
      continue;
    }
    const post: RssPost = { logNo, title: asText(rec.title) ?? "" };
    const category = asText(rec.category);
    const pubDate = asText(rec.pubDate);
    if (category) post.category = category;
    if (pubDate) post.pubDate = pubDate;
    posts.push(post);
  }
  return { posts, skipped };
}
