/**
 * 발행 금지 회귀 테스트(설계서 15장 수용 기준 4).
 * 합성 에디터 화면(tests/fixtures/fake-editor.html)에서 실제 브라우저로 확인한다. 네이버에 접속하지 않는다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDefaults, loadSelectors } from "../../src/lib/config/load";
import { EditorDriver } from "../../src/lib/naver/editorDriver";
import { PublishBlockedError, safeClick } from "../../src/lib/naver/publishGuard";

const sel = loadSelectors();
const timeouts = { ...loadDefaults().timeouts, stepMs: 3000, optionalMs: 500, saveConfirmMs: 2000 };
const fixtureUrl = pathToFileURL(path.join(import.meta.dirname, "../fixtures/fake-editor.html")).href;

let browser: Browser;
let page: Page;
let shotDir: string;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  shotDir = mkdtempSync(path.join(tmpdir(), "visit-draft-test-"));
});
afterAll(async () => {
  await browser?.close();
  rmSync(shotDir, { recursive: true, force: true });
});
beforeEach(async () => {
  page = await browser.newPage();
  await page.goto(fixtureUrl);
});

const published = () => page.evaluate(() => (window as unknown as { __published: boolean }).__published);

describe("safeClick", () => {
  it.each([
    ["class와 텍스트로 식별되는 발행 버튼", "button.publish_btn__fake"],
    ["발행 버튼 안쪽 span", "button.publish_btn__fake span"],
    ["aria-label로만 식별되는 발행 버튼", "button.plain_btn"],
  ])("%s 클릭을 차단한다", async (_, css) => {
    await expect(safeClick(page.locator(css), sel.editor.forbidden, timeouts.stepMs)).rejects.toThrow(
      PublishBlockedError,
    );
    expect(await published()).toBe(false);
  });

  it("저장 버튼은 클릭한다", async () => {
    await safeClick(page.locator("button.save_btn__fake"), sel.editor.forbidden, timeouts.stepMs);
    expect(await page.locator("#toast").isVisible()).toBe(true);
  });
});

describe("EditorDriver (합성 화면)", () => {
  it("제목·본문 입력 후 임시저장만 하고 발행하지 않는다", async () => {
    const driver = new EditorDriver(page, sel, timeouts);
    await driver.setTitle("테스트 제목");
    await driver.typeBody(["첫 줄", "둘째 줄"]);
    const result = await driver.saveDraft(shotDir);

    expect(result.ok).toBe(true);
    expect(await page.locator(".se-documentTitle .se-text-paragraph").innerText()).toBe("테스트 제목");
    expect(await page.locator(".se-component.se-text").innerText()).toContain("둘째 줄");
    expect(await published()).toBe(false);
  });

  it("publish 메서드가 없다", () => {
    expect("publish" in EditorDriver.prototype).toBe(false);
  });

  it("저장 버튼 선택자가 발행 버튼을 잘못 가리켜도 발행되지 않는다", async () => {
    // 네이버 화면이 바뀌어 선택자가 엉뚱한 버튼을 잡는 상황을 흉내 낸다
    const wrongSel = {
      ...sel,
      editor: {
        ...sel.editor,
        targets: { ...sel.editor.targets, saveButton: [{ css: "button.publish_btn__fake" }] },
      },
    };
    const driver = new EditorDriver(page, wrongSel, timeouts);
    await expect(driver.saveDraft(shotDir)).rejects.toThrow(PublishBlockedError);
    expect(await published()).toBe(false);
  });
});
