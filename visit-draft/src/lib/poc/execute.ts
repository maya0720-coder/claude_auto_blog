/**
 * 0단계 PoC 실행 본체(설계서 15장): 세션 유지 → 과거 글 조회·파싱 → 글쓰기·사진 → 임시저장 → 카테고리 확인.
 * 발행은 하지 않는다. 명령줄(scripts/)과 웹 앱(src/app/api/)이 함께 쓴다.
 * 결과는 data/poc/result-*.json에 저장한다(블로그 ID는 가림).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDefaults, loadSelectors, resolveDataPath } from "../config/load";
import { openPersistentBrowser } from "../naver/browser";
import { errorSummary, maskId } from "../util/common";
import { saveDebugSnapshot } from "../util/debug";
import type { PocArgs } from "./args";
import { toProjectPath } from "./paths";
import { stepReadPosts, stepSaveDraft, stepSession, UPLOAD_SUBDIR, type StepContext } from "./steps";
import type { PocEvent, PocReport, PocStepName, StepDetail, StepResult } from "./types";

export { reportHasFailure } from "./types";
export type { PocEvent, PocReport } from "./types";

export type PocEventHandler = (event: PocEvent) => void;

async function runStep(
  name: PocStepName,
  s: StepContext,
  debugDir: string,
  emit: PocEventHandler,
  fn: (s: StepContext) => Promise<StepDetail>,
): Promise<StepResult> {
  emit({ type: "step", step: name, status: "running" });
  try {
    const detail = await fn(s);
    emit({ type: "step", step: name, status: "ok" });
    return { step: name, status: "ok", detail };
  } catch (err) {
    const result: StepResult = { step: name, status: "failed", error: errorSummary(err) };
    const snap = await saveDebugSnapshot(s.page, debugDir, name);
    if (snap) result.debugSnapshot = toProjectPath(snap);
    emit({ type: "step", step: name, status: "failed", error: result.error });
    return result;
  }
}

function skipped(name: PocStepName, emit: PocEventHandler, error?: string): StepResult {
  emit({ type: "step", step: name, status: "skipped", ...(error ? { error } : {}) });
  return { step: name, status: "skipped", ...(error ? { error } : {}) };
}

/** PoC를 실행하고 보고서를 돌려준다. 단계 실패는 보고서에 담고, 브라우저를 열지 못하는 등의 오류만 던진다. */
export async function executePoc(args: PocArgs, emit: PocEventHandler): Promise<PocReport> {
  const sel = loadSelectors();
  const cfg = loadDefaults();
  const pocDir = resolveDataPath(cfg.output.pocDir);
  const debugDir = resolveDataPath(cfg.output.debugDir);
  mkdirSync(pocDir, { recursive: true });

  const log = (message: string) => emit({ type: "log", message });
  const attention = (message: string) => emit({ type: "attention", message });

  log("크롬 창을 여는 중입니다");
  const context = await openPersistentBrowser(cfg.browser);
  const page = context.pages()[0] ?? (await context.newPage());
  const s: StepContext = { context, page, sel, cfg, args, pocDir, log, attention };
  const results: StepResult[] = [];

  try {
    const session = await runStep("1-session", s, debugDir, emit, stepSession);
    results.push(session);
    const loggedIn = session.status === "ok";

    results.push(
      args.skipRead ? skipped("2-read-posts", emit) : await runStep("2-read-posts", s, debugDir, emit, stepReadPosts),
    );
    results.push(
      args.skipSave
        ? skipped("3-4-save-draft", emit)
        : !loggedIn
          ? skipped("3-4-save-draft", emit, "로그인 실패로 건너뜀")
          : await runStep("3-4-save-draft", s, debugDir, emit, stepSaveDraft),
    );
  } finally {
    await context.close();
    // EXIF를 지운 업로드용 사본도 저장이 끝나면 남기지 않는다
    rmSync(path.join(pocDir, UPLOAD_SUBDIR), { recursive: true, force: true });
  }

  const createdAt = new Date().toISOString();
  const file = path.join(pocDir, `result-${createdAt.replace(/[:.]/g, "-")}.json`);
  const report: PocReport = {
    createdAt,
    blog: maskId(args.blogId),
    categoryRequested: args.categoryNo !== undefined,
    results,
    resultFile: toProjectPath(file),
  };
  writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  log(`결과 저장: ${report.resultFile}`);
  return report;
}

