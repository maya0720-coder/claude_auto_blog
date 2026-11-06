/**
 * 네이버 임시저장 파이프라인: 로그인 확인 → 글쓰기 화면 → 제목·본문·사진(설명 포함) 입력 → "저장"만 누름.
 * 발행은 하지 않는다(EditorDriver에 발행 기능이 없고, 모든 클릭은 발행 가드를 거친다).
 */
import path from "node:path";
import type { Defaults, Selectors } from "../config/schema";
import { openPersistentBrowser } from "../naver/browser";
import { EditorDriver, SessionExpiredError } from "../naver/editorDriver";
import { PublishBlockedError } from "../naver/publishGuard";
import { ensureLogin } from "../naver/session";
import { UserFacingError } from "../runs/runManager";
import type { RunEvent } from "../runs/types";
import { errorSummary, withRetry } from "../util/common";
import { saveDebugSnapshot } from "../util/debug";
import { SaveLimit } from "./saveLimit";
import type { JobStore } from "./store";
import { ensureDisclosure } from "./types";

export async function runSave(
  jobId: string,
  store: JobStore,
  cfg: Defaults,
  sel: Selectors,
  emit: (e: RunEvent) => void,
): Promise<void> {
  const job = store.read(jobId);
  if (!job?.draft) throw new UserFacingError("저장할 원고가 없습니다. 먼저 원고를 만들어 주세요.");
  const limit = new SaveLimit(cfg.save);
  if (limit.remaining() <= 0) {
    throw new UserFacingError(`오늘 임시저장 한도(${cfg.save.dailyLimit}회)를 다 썼습니다. 내일 다시 시도해 주세요.`);
  }
  const draft = ensureDisclosure(job.draft, job.input.options.disclosure);
  const prevStatus = job.status;
  store.update(jobId, (j) => ({ ...j, status: "saving" }));

  const step = (s: string, status: "running" | "ok" | "warning" | "failed", message?: string) =>
    emit({ type: "step", step: s, status, ...(message ? { message } : {}) });
  let current = "login";
  const context = await openPersistentBrowser(cfg.browser);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    step("login", "running");
    await ensureLogin(context, page, sel.login, cfg.timeouts.loginWaitMs, (m) => emit({ type: "attention", message: m }));
    step("login", "ok");

    current = "editor";
    step("editor", "running");
    const driver = new EditorDriver(page, sel, cfg.timeouts);
    await withRetry(cfg.retries.step, () => driver.open(job.input.blogId, job.input.categoryNo), (e) => !(e instanceof SessionExpiredError));
    if ((await driver.handleResumeDialog()) === "dismissed") emit({ type: "log", message: "'작성 중인 글' 팝업이 떠서 새 글로 시작했습니다." });
    await driver.closeHelpPanel();
    const categoryVisible = (await driver.probeCategoryControl()) === "visible";
    step("editor", "ok");

    current = "content";
    step("content", "running");
    await driver.setTitle(draft.title);
    await driver.focusBodyStart();
    if (job.input.categoryNo && !categoryVisible) {
      // 임시저장 화면에서 카테고리를 고를 수 없으면, 발행 전에 사용자가 고를 수 있도록 메모를 남긴다(설계서 F7-6)
      await driver.typeParagraphs([`[저장 예정 카테고리 번호: ${job.input.categoryNo}] ← 발행 전에 카테고리를 고르고 이 줄을 지워 주세요`, ""]);
    }
    const photoCount = draft.blocks.filter((b) => b.type === "photo").length;
    let photoDone = 0;
    let captionFallbacks = 0;
    for (const block of draft.blocks) {
      if (block.type === "photo") {
        const photo = job.photos.find((p) => p.id === block.photoId);
        if (!photo) continue;
        const { captionOk } = await driver.insertPhoto(store.photoPath(jobId, photo, "upload"), block.caption);
        if (!captionOk && block.caption) {
          captionFallbacks += 1;
          await driver.typeParagraphs([`▲ ${block.caption}`]);
        }
        photoDone += 1;
        emit({ type: "log", message: `사진 ${photoDone}/${photoCount} 올림` });
      } else {
        await driver.typeParagraphs([...block.text.split("\n"), ""]);
      }
    }
    if (draft.hashtags.length) await driver.typeParagraphs([draft.hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")]);
    step("content", captionFallbacks ? "warning" : "ok", captionFallbacks ? `사진 설명 칸을 찾지 못해 ${captionFallbacks}개는 사진 아래 본문에 적었습니다.` : undefined);

    current = "save";
    step("save", "running");
    if (!limit.take()) throw new UserFacingError("오늘 임시저장 한도를 다 썼습니다.");
    const result = await driver.saveDraft(path.join(store.dir(jobId), "screens"));
    store.update(jobId, (j) => ({
      ...j,
      status: "saved",
      saved: { at: new Date().toISOString(), confirmed: result.ok, screenshot: path.basename(result.screenshot) },
    }));
    step("save", result.ok ? "ok" : "warning", result.ok ? undefined : "저장 완료 표시를 확인하지 못했습니다. 네이버 '저장 글' 목록에서 확인해 주세요.");
  } catch (err) {
    step(current as "login", "failed");
    const snap = await saveDebugSnapshot(page, path.join(store.dir(jobId), "debug"), current);
    store.update(jobId, (j) => ({ ...j, status: prevStatus === "saved" ? "saved" : "draft_ready" }));
    if (err instanceof UserFacingError) throw err;
    if (err instanceof PublishBlockedError) throw new UserFacingError("발행 버튼으로 보이는 요소를 눌러야 해서 멈췄습니다. 발행은 하지 않았습니다.");
    if (err instanceof SessionExpiredError) throw new UserFacingError("네이버 로그인이 만료되었습니다. 다시 시도하면 로그인 창이 열립니다.");
    throw new UserFacingError(
      `네이버 화면에서 진행하지 못했습니다(${errorSummary(err)}). 원고는 그대로 있으니 [본문 복사]로 직접 붙여 넣을 수 있습니다.${snap ? " 화면 기록을 남겼습니다." : ""}`,
    );
  } finally {
    await context.close();
  }
}
