/** 명령줄용 PoC 실행 래퍼. 실제 실행은 src/lib/poc/execute.ts가 맡는다. */
import { loadSelectors } from "../../src/lib/config/load";
import { ArgsError, parsePocArgs, USAGE } from "../../src/lib/poc/args";
import { executePoc, reportHasFailure, type PocEvent } from "../../src/lib/poc/execute";
import { errorSummary } from "../../src/lib/util/common";

/** 실행하지 않고 끝난 경우의 종료 코드 */
export const EXIT_CANCELLED = 3;

function printEvent(e: PocEvent): void {
  if (e.type === "step") {
    console.log(`[poc] ${e.step}: ${e.status}${e.error ? ` (${e.error})` : ""}`);
  } else {
    console.log(`[poc] ${e.type === "attention" ? "★ " : ""}${e.message}`);
  }
}

/** PoC 전체 실행. 종료 코드(0 성공, 1 단계 실패, 2 입력 오류)를 돌려준다. */
export async function runPoc(argv: string[]): Promise<number> {
  let args;
  try {
    args = parsePocArgs(argv, loadSelectors().blog.allowedHosts);
  } catch (err) {
    console.error(`${errorSummary(err)}\n\n${USAGE}`);
    return err instanceof ArgsError ? 2 : 1;
  }
  const report = await executePoc(args, printEvent);
  return reportHasFailure(report) ? 1 : 0;
}

/** 진입 스크립트용: 실행하고 종료 코드를 설정한다. argv가 없으면 취소로 본다. 예상치 못한 오류도 스택 없이 한 줄로 알린다. */
export function runAsEntry(argvPromise: Promise<string[] | undefined>): void {
  argvPromise
    .then((argv) => (argv ? runPoc(argv) : EXIT_CANCELLED))
    .then(
      (code) => {
        process.exitCode = code;
      },
      (err: unknown) => {
        console.error(`[poc] 실행 실패: ${errorSummary(err)}`);
        process.exitCode = 1;
      },
    );
}
