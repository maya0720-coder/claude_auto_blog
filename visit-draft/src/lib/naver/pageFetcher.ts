/**
 * 공개 블로그 글을 실제 브라우저 창으로 읽는다.
 * 네이버는 스크립트용 HTTP 요청(Playwright request·fetch)에 응답하지 않아, 사용자가 고른 방식대로
 * 화면에 보이는 브라우저 창을 잠깐 열어 읽는다. 사용자 에이전트 위장 등 차단 우회는 하지 않는다.
 * 로그인 프로필(data/browser-profile)은 쓰지 않는다: 쿠키 없는 새 창이라 공개 글만 읽힌다.
 */
import { chromium, type Browser, type Page } from "playwright";
import type { Defaults } from "../config/schema";
import type { HttpGetter } from "./blogReader";

/** 글 구성 분석에 필요 없는 리소스는 받지 않는다(빠르고 트래픽이 적음) */
const SKIP_TYPES = new Set(["image", "media", "font", "stylesheet"]);

export interface PageFetcher extends HttpGetter {
  close(): Promise<void>;
}

/** 페이지 이동 응답의 원본 본문(서버가 보낸 HTML·XML)을 돌려준다 */
export function pageGetter(page: Page): HttpGetter {
  return {
    async get(url, { timeout }) {
      const res = await page.goto(url, { timeout, waitUntil: "domcontentloaded" });
      if (!res) throw new Error("응답이 없습니다.");
      return { ok: () => res.ok(), status: () => res.status(), text: () => res.text() };
    },
  };
}

export async function openPageFetcher(cfg: Defaults): Promise<PageFetcher> {
  const browser: Browser = await chromium.launch({ headless: cfg.browser.headless });
  try {
    const context = await browser.newContext({ locale: "ko-KR" });
    const page = await context.newPage();
    await page.route("**/*", (route) => (SKIP_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue()));
    const getter = pageGetter(page);
    return { get: getter.get, close: () => browser.close() };
  } catch (err) {
    await browser.close();
    throw err;
  }
}
