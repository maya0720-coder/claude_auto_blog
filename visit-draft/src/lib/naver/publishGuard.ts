import type { Locator } from "playwright";
import type { ForbiddenRules } from "../config/schema";

/**
 * 발행 방지 가드(설계서 F7-7, CLAUDE.md "발행 금지").
 * 이 프로젝트에서 네이버 화면의 클릭은 모두 safeClick을 거친다. 직접 locator.click()을 호출하지 않는다.
 */
export class PublishBlockedError extends Error {
  override name = "PublishBlockedError";
}

export interface ClickTargetInfo {
  /** 요소 자신과, 가장 가까운 클릭 가능 조상(button, a, [role=button])의 정보 */
  texts: string[];
  classNames: string[];
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/** 클릭 대상이 발행 관련 요소인지 판정한다. 판정할 정보가 없으면 안전하게 거부한다. */
export function isForbidden(info: ClickTargetInfo, rules: ForbiddenRules): boolean {
  if (info.texts.length === 0 && info.classNames.length === 0) return true;
  const texts = info.texts.map(normalize).filter(Boolean);
  const classes = info.classNames.join(" ").toLowerCase();
  const textHit = rules.texts.some((word) => texts.some((t) => t.includes(word)));
  const classHit = rules.classFragments.some((frag) => classes.includes(frag.toLowerCase()));
  return textHit || classHit;
}

/** 브라우저 안에서 실행: 요소와 클릭 가능 조상의 텍스트·aria-label·title·class를 모은다. */
function collectInfo(el: Element): ClickTargetInfo {
  const nodes: Element[] = [el];
  const clickable = el.closest("button, a, [role='button']");
  if (clickable && clickable !== el) nodes.push(clickable);
  const texts: string[] = [];
  const classNames: string[] = [];
  for (const n of nodes) {
    const text = (n as HTMLElement).innerText ?? n.textContent ?? "";
    for (const v of [text, n.getAttribute("aria-label"), n.getAttribute("title"), n.getAttribute("value")]) {
      if (v) texts.push(v);
    }
    const cls = n.getAttribute("class");
    if (cls) classNames.push(cls);
    // 클래스·텍스트가 비어 있어도 판정할 수 있도록 태그 이름을 남긴다
    classNames.push(`tag:${n.tagName.toLowerCase()}`);
  }
  return { texts, classNames };
}

export async function inspectClickTarget(locator: Locator): Promise<ClickTargetInfo> {
  return locator.evaluate(collectInfo);
}

/** 발행 관련 요소가 아님을 확인한 뒤에만 클릭한다. */
export async function safeClick(locator: Locator, rules: ForbiddenRules, timeoutMs: number): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const info = await inspectClickTarget(locator);
  if (isForbidden(info, rules)) {
    throw new PublishBlockedError("발행 관련 요소로 판단되어 클릭을 차단했습니다.");
  }
  await locator.click({ timeout: timeoutMs });
}
