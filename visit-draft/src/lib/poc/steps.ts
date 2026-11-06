import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { Defaults, Selectors } from "../config/schema";
import { makeUploadCopies, validateImagePaths } from "../images/prepare";
import { readRecentPosts } from "../naver/blogReader";
import { EditorDriver, SessionExpiredError } from "../naver/editorDriver";
import { PublishBlockedError } from "../naver/publishGuard";
import { ensureLogin } from "../naver/session";
import { withRetry } from "../util/common";
import { toProjectPath } from "./paths";
import type { StepDetail } from "./types";
import type { PocArgs } from "./args";

export interface StepContext {
  context: BrowserContext;
  page: Page;
  sel: Selectors;
  cfg: Defaults;
  args: PocArgs;
  pocDir: string;
  log: (message: string) => void;
  /** 사용자가 직접 해야 할 일(로그인 등) 안내 */
  attention: (message: string) => void;
}

export type { StepDetail };

/** 업로드용 사본(EXIF 제거)을 두는 하위 폴더. 실행이 끝나면 지운다. */
export const UPLOAD_SUBDIR = "upload";

const isRetryable = (err: unknown) => !(err instanceof SessionExpiredError || err instanceof PublishBlockedError);

/** ① 세션 유지: 이전 실행의 세션이 남아 있었는지, 로그인이 되었는지 */
export async function stepSession(s: StepContext): Promise<StepDetail> {
  const { hadSession } = await ensureLogin(s.context, s.page, s.sel.login, s.cfg.timeouts.loginWaitMs, s.attention);
  return { hadSessionAtStart: hadSession, loggedIn: true };
}

/** ② 과거 글 조회·파싱 */
export async function stepReadPosts(s: StepContext): Promise<StepDetail> {
  const result = await withRetry(s.cfg.retries.step, () =>
    readRecentPosts(
      s.context.request,
      s.args.blogId,
      s.cfg.reader.postCount,
      s.sel.blog,
      s.cfg.reader,
      s.cfg.timeouts.stepMs,
    ),
  );
  // 카테고리 이름은 개인 블로그 정보이므로 개수만 남긴다
  const { categoriesSeen, ...rest } = result;
  return { ...rest, categoriesSeenCount: categoriesSeen.length };
}

/** ③④ 글쓰기 화면에 제목·텍스트·사진 입력 → 임시저장, 카테고리 지정 가능 여부 확인 */
export async function stepSaveDraft(s: StepContext): Promise<StepDetail> {
  const files = validateImagePaths(s.args.images, s.cfg.images, s.cfg.images.pocMaxCount);
  const uploads = await makeUploadCopies(files, path.join(s.pocDir, UPLOAD_SUBDIR), s.cfg.images.stripMetadata);

  const driver = new EditorDriver(s.page, s.sel, s.cfg.timeouts);
  const detail: StepDetail = { imageCount: uploads.length, metadataStripped: s.cfg.images.stripMetadata };

  const { usedFrame } = await withRetry(
    s.cfg.retries.step,
    () => driver.open(s.args.blogId, s.args.categoryNo),
    isRetryable,
  );
  detail.editorInFrame = usedFrame;
  detail.resumeDialog = await driver.handleResumeDialog();
  detail.helpPanelClosed = await driver.closeHelpPanel();

  const category = await driver.probeCategoryControl();
  detail.categoryControl = category;
  detail.categoryRequested = s.args.categoryNo !== undefined;

  const lines = [
    "이 글은 자동 임시저장 PoC 테스트입니다.",
    "발행하지 말고 확인 후 삭제해 주세요.",
  ];
  // 카테고리 선택 요소를 찾지 못하면 설계서 F7-6의 대체 방안대로 본문 맨 위에 메모를 남긴다
  if (s.args.categoryNo !== undefined && category === "unsupported") {
    lines.unshift(`[저장 예정 카테고리: ${s.args.categoryNo}]`);
    detail.categoryMemoInserted = true;
  }

  await driver.setTitle(s.args.title);
  await driver.typeBody(lines);
  s.log(`사진 업로드 시작 (${uploads.length}장)`);
  await driver.uploadImages(uploads, (done, total) => s.log(`사진 ${done}/${total} 업로드 완료`));

  const saved = await driver.saveDraft(s.pocDir);
  detail.saveConfirmed = saved.ok;
  detail.screenshot = toProjectPath(saved.screenshot);
  if (!saved.ok) {
    s.log("저장 완료 표시를 확인하지 못했습니다. 네이버 '저장 글' 목록에서 직접 확인해 주세요.");
  }
  return detail;
}
