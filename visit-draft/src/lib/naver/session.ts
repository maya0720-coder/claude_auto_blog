import type { BrowserContext, Page } from "playwright";
import type { Selectors } from "../config/schema";

export type LoginSelectors = Selectors["login"];

export class LoginTimeoutError extends Error {
  override name = "LoginTimeoutError";
}

/** 세션 쿠키가 있는지만 확인한다. 쿠키 값은 읽어서 남기지 않는다. */
export async function hasSessionCookie(context: BrowserContext, sel: LoginSelectors): Promise<boolean> {
  const cookies = await context.cookies(sel.checkUrl);
  return cookies.some((c) => c.name === sel.sessionCookie && c.value.length > 0);
}

/**
 * 세션이 없으면 로그인 페이지를 열고, 사용자가 직접 로그인할 때까지 기다린다.
 * 아이디·비밀번호를 입력하거나 저장하지 않는다. 캡차·기기 인증도 사용자가 처리한다.
 */
export async function ensureLogin(
  context: BrowserContext,
  page: Page,
  sel: LoginSelectors,
  timeoutMs: number,
  onWaiting: (message: string) => void,
): Promise<{ hadSession: boolean }> {
  if (await hasSessionCookie(context, sel)) return { hadSession: true };

  await page.goto(sel.loginUrl, { waitUntil: "domcontentloaded" });
  onWaiting("열린 크롬 창에서 네이버에 직접 로그인해 주세요. (보안 확인이 나오면 직접 처리해 주세요)");

  // 로그인이 끝나면 로그인 도메인을 벗어난다. 그 시점에 세션 쿠키를 확인한다.
  try {
    await page.waitForURL((url) => !url.hostname.includes(sel.loginHostFragment), { timeout: timeoutMs });
  } catch {
    throw new LoginTimeoutError("로그인 대기 시간이 지났습니다. 다시 실행해 주세요.");
  }
  if (!(await hasSessionCookie(context, sel))) {
    throw new LoginTimeoutError("로그인 세션을 확인하지 못했습니다. 다시 실행해 주세요.");
  }
  return { hadSession: false };
}

/** 페이지가 로그인 화면으로 이동했는지(세션 만료) 확인한다. */
export function isOnLoginPage(page: Page, sel: LoginSelectors): boolean {
  try {
    return new URL(page.url()).hostname.includes(sel.loginHostFragment);
  } catch {
    return false;
  }
}
