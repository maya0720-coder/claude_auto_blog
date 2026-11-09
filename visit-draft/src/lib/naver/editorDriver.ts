import type { Locator, Page } from "playwright";
import { fillTemplate } from "../config/load";
import type { Defaults, Selectors, TargetSpec } from "../config/schema";
import { saveScreenshot } from "../util/debug";
import { safeClick } from "./publishGuard";
import { isOnLoginPage } from "./session";
import { hasEmoji, splitEmoji, withoutEmoji } from "./textSegments";
import { allMatches, findOptionalTarget, findTarget, type LocatorRoot } from "./target";

export class SessionExpiredError extends Error {
  override name = "SessionExpiredError";
}

type Targets = Selectors["editor"]["targets"];

/**
 * 스마트에디터 ONE 자동화(설계서 9.5장).
 * 임시저장 전용이다. publish()는 의도적으로 구현하지 않는다.
 * 모든 클릭은 safeClick(발행 가드)을 거친다.
 */
export class EditorDriver {
  private root: LocatorRoot;

  constructor(
    private readonly page: Page,
    private readonly sel: Selectors,
    private readonly timeouts: Defaults["timeouts"],
  ) {
    this.root = page;
  }

  private find(name: keyof Targets, timeoutMs = this.timeouts.stepMs) {
    return findTarget(this.root, name, this.sel.editor.targets[name], timeoutMs);
  }

  private findOptional(name: keyof Targets) {
    return findOptionalTarget(this.root, name, this.sel.editor.targets[name], this.timeouts.optionalMs);
  }

  private click(spec: Awaited<ReturnType<EditorDriver["find"]>>) {
    return safeClick(spec, this.sel.editor.forbidden, this.timeouts.stepMs);
  }

  /** 글쓰기 화면을 연다. 에디터가 iframe 안에 있으면 그 안을 기준으로 찾는다. */
  async open(blogId: string, categoryNo: string | undefined): Promise<{ usedFrame: boolean }> {
    const url = fillTemplate(this.sel.editor.writeUrl, { blogId, categoryNo: categoryNo ?? "" });
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeouts.stepMs });
    if (isOnLoginPage(this.page, this.sel.login)) {
      throw new SessionExpiredError("네이버 로그인이 만료되었습니다. 다시 실행해 로그인해 주세요.");
    }

    let usedFrame = false;
    const frameSel = this.sel.editor.frame;
    if (frameSel) {
      try {
        await this.page.locator(frameSel).waitFor({ state: "attached", timeout: this.timeouts.optionalMs });
        this.root = this.page.frameLocator(frameSel);
        usedFrame = true;
      } catch {
        this.root = this.page;
      }
    }
    // 제목 칸이 보이면 에디터가 준비된 것으로 본다. 보이지 않으면 권한 없음 또는 화면 구조 변경
    await this.find("title");
    return { usedFrame };
  }

  /** "작성 중인 글이 있습니다" 팝업: 기존 임시글을 덮어쓰지 않도록 "새로 작성" 쪽을 고른다. */
  async handleResumeDialog(): Promise<"none" | "dismissed"> {
    const dialog = await this.findOptional("resumeDialog");
    if (!dialog) return "none";
    await this.click(await this.find("resumeDialogNew"));
    await dialog.waitFor({ state: "hidden", timeout: this.timeouts.stepMs });
    return "dismissed";
  }

  async closeHelpPanel(): Promise<boolean> {
    const btn = await this.findOptional("helpPanelClose");
    if (!btn) return false;
    await this.click(btn);
    return true;
  }

  async setTitle(title: string): Promise<void> {
    await this.click(await this.find("title"));
    await this.page.keyboard.insertText(title);
  }

  /** 본문 첫 문단에 텍스트를 넣는다. 줄마다 Enter로 문단을 나눈다. */
  async typeBody(lines: string[]): Promise<void> {
    await this.click(await this.find("body"));
    for (const [i, line] of lines.entries()) {
      if (line) await this.page.keyboard.insertText(line);
      if (i < lines.length - 1) await this.page.keyboard.press("Enter");
    }
  }

  /** 사진을 1장씩 올리고, 에디터에 사진이 하나 늘어난 것을 확인한 뒤 다음 사진으로 넘어간다. */
  async uploadImages(files: string[], onProgress: (done: number, total: number) => void): Promise<void> {
    const uploaded = allMatches(this.root, this.sel.editor.targets.uploadedImage);
    for (const [i, file] of files.entries()) {
      const before = await uploaded.count();
      const chooserPromise = this.page.waitForEvent("filechooser", { timeout: this.timeouts.stepMs });
      await this.click(await this.find("imageButton"));
      const chooser = await chooserPromise;
      await chooser.setFiles(file);
      await uploaded.nth(before).waitFor({ state: "visible", timeout: this.timeouts.imageUploadMs });
      onProgress(i + 1, files.length);
    }
  }

  /** 본문 첫 문단으로 커서를 옮긴다. */
  async focusBodyStart(): Promise<void> {
    await this.click(await this.find("body"));
  }

  /** 현재 커서 위치에 문단들을 입력한다. 마지막에 Enter를 눌러 다음 내용이 새 문단에서 시작하게 한다. */
  async typeParagraphs(lines: string[]): Promise<void> {
    for (const line of lines) {
      if (line) await this.typeLine(line);
      await this.page.keyboard.press("Enter");
    }
  }

  /**
   * 소제목: 굵게(Ctrl+B 켜고 끄기) 한 줄로 넣고, 아래에 빈 줄을 둔다.
   * 단축키를 지원하지 않는 화면이면 굵게만 빠지고 글자는 그대로 들어간다.
   */
  async typeHeading(text: string): Promise<void> {
    await this.page.keyboard.press("Control+b");
    await this.typeLine(text);
    await this.page.keyboard.press("Control+b");
    await this.page.keyboard.press("Enter");
  }

  /**
   * 한 줄 입력. 이모지가 섞이면 조각별로 나눠 넣는다(한 번에 넣으면 이모지 뒤 글자가 사라졌음).
   * 넣은 뒤 이모지를 뺀 글자가 화면에 있는지 확인하고, 없으면 키 입력으로 다시 넣는다.
   */
  private async typeLine(line: string): Promise<void> {
    if (!hasEmoji(line)) {
      await this.page.keyboard.insertText(line);
      return;
    }
    for (const seg of splitEmoji(line)) await this.page.keyboard.insertText(seg);
    const plain = withoutEmoji(line);
    if (!plain) return;
    const probe = plain.slice(-Math.min(plain.length, 20));
    const typed = this.root.locator(this.sel.blog.paragraph).filter({ hasText: probe });
    try {
      await typed.first().waitFor({ state: "attached", timeout: this.timeouts.optionalMs });
    } catch {
      await this.page.keyboard.type(` ${plain}`);
    }
  }

  /**
   * 현재 위치에 사진 1장을 올리고 설명을 넣은 뒤, 사진 아래 문단으로 커서를 옮긴다.
   * 설명 칸을 찾지 못하면 captionOk=false를 돌려준다(호출한 쪽이 본문에 설명을 대신 적는다).
   */
  async insertPhoto(file: string, caption: string): Promise<{ captionOk: boolean }> {
    const images = allMatches(this.root, this.sel.editor.targets.imageComponent);
    const before = await images.count();
    const chooserPromise = this.page.waitForEvent("filechooser", { timeout: this.timeouts.stepMs });
    await this.click(await this.find("imageButton"));
    await (await chooserPromise).setFiles(file);
    const image = images.nth(before);
    await image.waitFor({ state: "visible", timeout: this.timeouts.imageUploadMs });

    let captionOk = false;
    if (caption) {
      const captionBox = image.locator(this.sel.editor.imageCaptionInImage).first();
      try {
        await safeClick(captionBox, this.sel.editor.forbidden, this.timeouts.optionalMs);
        await this.page.keyboard.insertText(caption);
        captionOk = true;
      } catch {
        captionOk = false;
      }
    }
    await this.focusAfter(image);
    return { captionOk };
  }

  /** 사진 바로 다음 본문 문단 끝으로 커서를 옮긴다. 문단이 없으면 사진을 선택하고 Enter로 새 문단을 만든다. */
  private async focusAfter(image: Locator): Promise<void> {
    const next = image.locator(this.sel.editor.afterImageParagraph).last();
    try {
      await next.waitFor({ state: "visible", timeout: this.timeouts.optionalMs });
    } catch {
      await safeClick(image, this.sel.editor.forbidden, this.timeouts.stepMs);
      await this.page.keyboard.press("Enter");
      await next.waitFor({ state: "visible", timeout: this.timeouts.stepMs });
    }
    await safeClick(next, this.sel.editor.forbidden, this.timeouts.stepMs);
    await this.page.keyboard.press("End");
  }

  /**
   * 발행 설정 창을 열지 않고 카테고리 선택 요소가 보이는지만 확인한다(U1).
   * 네이버 화면상 카테고리 선택은 발행 설정 창 안에 있을 수 있고, 그 창은 발행 버튼으로 열리므로 열지 않는다.
   */
  async probeCategoryControl(): Promise<"visible" | "unsupported"> {
    return (await this.findOptional("categorySelect")) ? "visible" : "unsupported";
  }

  /** "저장"(임시저장) 버튼만 누르고 완료 표시를 확인한다. 증거 스크린샷 경로를 돌려준다. */
  async saveDraft(screenshotDir: string): Promise<{ ok: boolean; screenshot: string }> {
    await this.click(await this.find("saveButton"));
    const done = await findOptionalTarget(
      this.root,
      "saveDone",
      this.sel.editor.targets.saveDone as TargetSpec,
      this.timeouts.saveConfirmMs,
    );
    const screenshot = await saveScreenshot(this.page, screenshotDir, done ? "draft-saved" : "draft-unconfirmed");
    return { ok: !!done, screenshot };
  }
}
