import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { resolveDataPath } from "../config/load";
import type { Defaults } from "../config/schema";

/**
 * 로그인 세션을 유지하는 브라우저를 연다(설계서 F8).
 * 프로필 폴더는 로그인 세션과 같으므로 data/ 아래(.gitignore)에만 둔다.
 */
export async function openPersistentBrowser(cfg: Defaults["browser"]): Promise<BrowserContext> {
  const profileDir = resolveDataPath(cfg.profileDir);
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  return chromium.launchPersistentContext(profileDir, {
    headless: cfg.headless,
    slowMo: cfg.slowMoMs,
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
  });
}
