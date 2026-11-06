import type { FrameLocator, Locator, Page } from "playwright";
import type { TargetSpec, TargetStrategy } from "../config/schema";

/** Page와 FrameLocator 모두에서 쓸 수 있는 공통 조회 면 */
export type LocatorRoot = Pick<Page | FrameLocator, "locator" | "getByRole" | "getByText">;

export class TargetNotFoundError extends Error {
  override name = "TargetNotFoundError";
  constructor(public readonly targetName: string) {
    super(`화면 요소를 찾지 못했습니다: ${targetName}`);
  }
}

function toLocator(root: LocatorRoot, s: TargetStrategy): Locator {
  if ("role" in s) {
    return root.getByRole(s.role as Parameters<Page["getByRole"]>[0], { name: s.name });
  }
  if ("text" in s) return root.getByText(s.text);
  return root.locator(s.css);
}

/**
 * 설정의 선택자 후보를 순서대로 시도해, 처음 보이는 요소를 돌려준다.
 * 전체 대기 시간은 timeoutMs 안에서 후보마다 나눠 쓴다.
 */
export async function findTarget(
  root: LocatorRoot,
  name: string,
  spec: TargetSpec,
  timeoutMs: number,
): Promise<Locator> {
  const perTry = Math.max(500, Math.floor(timeoutMs / spec.length));
  for (const strategy of spec) {
    const loc = toLocator(root, strategy).first();
    try {
      await loc.waitFor({ state: "visible", timeout: perTry });
      return loc;
    } catch {
      // 다음 후보로 넘어간다
    }
  }
  throw new TargetNotFoundError(name);
}

/** 선택적 요소(팝업 등)용: 없으면 undefined */
export async function findOptionalTarget(
  root: LocatorRoot,
  name: string,
  spec: TargetSpec,
  timeoutMs: number,
): Promise<Locator | undefined> {
  try {
    return await findTarget(root, name, spec, timeoutMs);
  } catch (err) {
    if (err instanceof TargetNotFoundError) return undefined;
    throw err;
  }
}

/** 개수를 세야 하는 요소용(업로드된 사진 등): 첫 번째 후보 선택자의 Locator 전체 */
export function allMatches(root: LocatorRoot, spec: TargetSpec): Locator {
  const first = spec[0];
  if (!first) throw new TargetNotFoundError("(빈 선택자)");
  return toLocator(root, first);
}
