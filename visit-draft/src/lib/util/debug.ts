import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

const safeLabel = (label: string) => label.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** 스크린샷을 저장하고 경로를 돌려준다. */
export async function saveScreenshot(page: Page, dir: string, label: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp()}-${safeLabel(label)}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

/**
 * 실패 시점의 스크린샷과 HTML을 남긴다(설계서 F7 안정성 규칙).
 * data/debug/는 .gitignore 대상이다. 화면에 로그인 정보가 보일 수 있으므로 외부로 공유하지 않는다.
 * 스냅샷 저장 자체가 실패해도 원래 오류를 가리지 않도록 예외를 밖으로 던지지 않는다.
 */
export async function saveDebugSnapshot(page: Page, dir: string, label: string): Promise<string | undefined> {
  try {
    const shot = await saveScreenshot(page, dir, label);
    writeFileSync(shot.replace(/\.png$/, ".html"), await page.content(), "utf8");
    return shot;
  } catch (err) {
    console.error(`[debug] 스냅샷 저장 실패: ${(err as Error).message}`);
    return undefined;
  }
}
