/**
 * 원고 입력 순서 검증: 합성 에디터 화면에서 문단 → 사진(설명) → 문단 → 사진 순서로 들어가는지,
 * 그리고 끝까지 발행 버튼이 눌리지 않는지 확인한다. 네이버에 접속하지 않는다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDefaults, loadSelectors } from "../../src/lib/config/load";
import { EditorDriver } from "../../src/lib/naver/editorDriver";

const sel = loadSelectors();
const timeouts = { ...loadDefaults().timeouts, stepMs: 4000, optionalMs: 800, imageUploadMs: 4000, saveConfirmMs: 2000 };
const fixtureUrl = pathToFileURL(path.join(import.meta.dirname, "../fixtures/fake-editor-photos.html")).href;

let browser: Browser;
let page: Page;
let dir: string;
let img1: string;
let img2: string;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  dir = mkdtempSync(path.join(tmpdir(), "visit-draft-editor-"));
  img1 = path.join(dir, "one.jpg");
  img2 = path.join(dir, "two.jpg");
  await sharp({ create: { width: 40, height: 30, channels: 3, background: "#c33" } }).jpeg().toFile(img1);
  await sharp({ create: { width: 40, height: 30, channels: 3, background: "#33c" } }).jpeg().toFile(img2);
});
afterAll(async () => {
  await browser?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 본문 컴포넌트를 순서대로 읽어 "text:..." / "image:파일명|설명" 목록으로 만든다 */
const bodyOrder = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#body .se-component")]
      .map((c) => {
        const el = c as HTMLElement;
        if (el.classList.contains("se-image")) {
          return `image:${el.dataset.name}|${el.querySelector(".se-caption")?.textContent?.trim() ?? ""}`;
        }
        return `text:${(el.textContent ?? "").trim()}`;
      })
      .filter((s) => s !== "text:"),
  );

describe("EditorDriver.insertPhoto (합성 화면)", () => {
  it("문단과 사진을 원고 순서대로 넣고, 사진 설명을 채우며, 발행하지 않는다", async () => {
    page = await browser.newPage();
    await page.goto(fixtureUrl);
    const driver = new EditorDriver(page, sel, timeouts);

    await driver.setTitle("테스트 제목");
    await driver.focusBodyStart();
    await driver.typeParagraphs(["첫 문단"]);
    expect((await driver.insertPhoto(img1, "빨간 사진")).captionOk).toBe(true);
    await driver.typeParagraphs(["사진 다음 문단"]);
    expect((await driver.insertPhoto(img2, "파란 사진")).captionOk).toBe(true);
    await driver.typeParagraphs(["마지막 문단"]);
    const saved = await driver.saveDraft(dir);

    expect(saved.ok).toBe(true);
    expect(await bodyOrder()).toEqual([
      "text:첫 문단",
      "image:one.jpg|빨간 사진",
      "text:사진 다음 문단",
      "image:two.jpg|파란 사진",
      "text:마지막 문단",
    ]);
    expect(await page.evaluate(() => (window as unknown as { __published: boolean }).__published)).toBe(false);
  });

  it("소제목: 이모지와 섞인 입력을 한 번에 받으면 뒤 글자를 버리는 화면에서도 소제목 글자가 모두 들어간다", async () => {
    page = await browser.newPage();
    await page.goto(fixtureUrl);
    await page.evaluate(() => {
      // 실제 저장에서 본 증상 재현: 이모지 + 글자를 한 번에 넣으면 이모지만 남긴다
      document.addEventListener(
        "beforeinput",
        (e) => {
          const data = e.data ?? "";
          const emoji = data.match(/^\p{Extended_Pictographic}️?/u)?.[0];
          if (e.inputType === "insertText" && emoji && data.length > emoji.length) {
            e.preventDefault();
            document.execCommand("insertText", false, emoji);
          }
        },
        true,
      );
    });
    const driver = new EditorDriver(page, sel, timeouts);
    await driver.focusBodyStart();
    await driver.typeHeading("🌿 남양주 비스타밸리로 떠난 가족 나들이");
    await driver.typeParagraphs(["본문 문단"]);
    const text = await page.evaluate(() => document.querySelector("#body")!.textContent ?? "");
    expect(text).toContain("🌿 남양주 비스타밸리로 떠난 가족 나들이");
    expect(text).toContain("본문 문단");
    // 소제목은 굵게
    expect(await page.evaluate(() => document.querySelector("#body b, #body strong")?.textContent ?? "")).toContain("남양주 비스타밸리");
  });

  it("설명 칸이 없는 화면이면 captionOk=false를 돌려준다(호출한 쪽이 본문에 적음)", async () => {
    page = await browser.newPage();
    await page.goto(fixtureUrl);
    await page.evaluate(() => {
      // 설명 칸을 만들지 않는 화면으로 바꾼다
      const input = document.getElementById("file")!;
      input.addEventListener("change", () => document.querySelectorAll(".se-caption").forEach((c) => c.remove()));
    });
    const driver = new EditorDriver(page, sel, timeouts);
    await driver.focusBodyStart();
    expect((await driver.insertPhoto(img1, "설명")).captionOk).toBe(false);
  });
});
