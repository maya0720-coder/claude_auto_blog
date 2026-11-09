/**
 * 참고 블로그·내 블로그 글을 브라우저 창으로 읽는 경로(pageFetcher.pageGetter → readSinglePost) 검증.
 * 네이버 주소 요청은 page.route로 가로채 합성 글(tests/fixtures/se-post.html)을 돌려준다. 실제로 접속하지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSelectors } from "../../src/lib/config/load";
import { readSinglePost } from "../../src/lib/naver/blogReader";
import { pageGetter } from "../../src/lib/naver/pageFetcher";

const sel = loadSelectors();
const html = readFileSync(path.join(import.meta.dirname, "../fixtures", "se-post.html"), "utf8");

let browser: Browser;
let page: Page;
let seen: string[];

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  page = await browser.newPage();
  seen = [];
  // 모든 외부 요청을 막고, 글 주소만 합성 본문(또는 404)으로 답한다
  await page.route("**/*", (route) => {
    const url = route.request().url();
    seen.push(url);
    if (url.includes("/missing_blog/")) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
});

describe("pageGetter (브라우저 창으로 글 읽기)", () => {
  it("글 주소를 열어 서버가 보낸 원본 HTML로 구성 발췌를 만든다", async () => {
    const r = await readSinglePost(pageGetter(page), "other_blog", "223456789012", sel.blog, 5000, 4000);
    expect(seen[0]).toBe("https://m.blog.naver.com/other_blog/223456789012");
    expect(r.parsedOk).toBe(1);
    expect(r.excerpts[0]).toContain("[사진");
  });
  it("HTTP 오류면 상태 코드와 함께 실패한다", async () => {
    await expect(readSinglePost(pageGetter(page), "missing_blog", "1", sel.blog, 5000, 4000)).rejects.toThrow(/404/);
  });
});
