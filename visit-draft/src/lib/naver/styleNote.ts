/**
 * 블로그 문체·구성 참고 자료: 공개 글의 구성 지표 + 발췌를 글로 정리한다.
 * 내 블로그(최근 글 몇 편) 또는 참고 블로그(블로그 전체의 최근 글, 또는 지정한 글 한 편)를 읽는다.
 * 같은 대상은 설정한 시간 동안 캐시한다(data/jobs/_style/<blogId>[-<logNo>].json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataPath } from "../config/load";
import type { Defaults, Selectors } from "../config/schema";
import { isValidBlogId } from "./blogUrl";
import { readRecentPosts, readSinglePost, type ReadPostsResult } from "./blogReader";
import { openPageFetcher } from "./pageFetcher";

interface Cached {
  savedAt: string;
  note: string;
}

export function formatStyleNote(r: Pick<ReadPostsResult, "stats" | "excerpts" | "parsedOk" | "legacyOrUnknown">): string {
  const s = r.stats;
  const lines = [
    `분석한 글: 블록 구조 ${r.parsedOk}편, 텍스트만 ${r.legacyOrUnknown}편`,
    s.postCount
      ? `글 하나당 평균 블록 ${s.avgBlocksPerPost}개, 사진 ${s.avgImagesPerPost}장, 문단 평균 ${s.avgParagraphChars}자, 연속 사진 최대 ${s.maxConsecutiveImages}장`
      : "",
    s.postCount
      ? `사용 요소: ${Object.entries(s.uses)
          .filter(([, v]) => v)
          .map(([k]) => ({ heading: "소제목", quote: "인용구", divider: "구분선", map: "지도", sticker: "스티커" })[k])
          .join(", ") || "특별한 요소 없음"}`
      : "",
  ].filter(Boolean);
  const samples = r.excerpts.map((e, i) => `### 참고 글 ${i + 1}\n${e}`);
  return [...lines, ...samples].join("\n\n");
}

export interface StyleSource {
  blogId: string;
  /** 있으면 이 글 한 편만 읽는다 */
  logNo?: string | undefined;
  /** 참고 블로그(템플릿)면 발췌를 더 길게 받는다 */
  template?: boolean;
}

export async function buildStyleNote(source: StyleSource, cfg: Defaults, sel: Selectors): Promise<string> {
  const { blogId, logNo } = source;
  if (!isValidBlogId(blogId)) throw new Error("블로그 ID 형식이 올바르지 않습니다.");
  if (logNo !== undefined && !/^\d{1,20}$/.test(logNo)) throw new Error("글 번호 형식이 올바르지 않습니다.");
  const maxChars = source.template ? cfg.ai.templateSampleChars : cfg.ai.styleSampleChars;
  const cacheDir = resolveDataPath(path.join(cfg.jobs.dir, "_style"));
  const cacheFile = path.join(cacheDir, `${blogId}${logNo ? `-${logNo}` : ""}${source.template ? "-t" : ""}.json`);
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as Cached;
      const ageH = (Date.now() - Date.parse(cached.savedAt)) / 3_600_000;
      if (typeof cached.note === "string" && ageH < cfg.jobs.styleCacheHours) return cached.note;
    } catch {
      // 캐시가 깨졌으면 새로 만든다
    }
  }

  // 네이버가 스크립트 요청에는 응답하지 않아 브라우저 창으로 읽는다(pageFetcher.ts)
  const ctx = await openPageFetcher(cfg);
  try {
    const result = logNo
      ? await readSinglePost(ctx, blogId, logNo, sel.blog, cfg.timeouts.stepMs, maxChars)
      : await readRecentPosts(ctx, blogId, cfg.reader.postCount, sel.blog, cfg.reader, cfg.timeouts.stepMs, {
          maxPosts: cfg.ai.styleSamplePosts,
          maxChars,
        });
    if (result.excerpts.length === 0) throw new Error("읽을 수 있는 공개 글이 없습니다.");
    const note = formatStyleNote(result);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ savedAt: new Date().toISOString(), note } satisfies Cached), "utf8");
    return note;
  } finally {
    await ctx.close();
  }
}
