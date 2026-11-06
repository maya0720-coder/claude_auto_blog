import { setTimeout as wait } from "node:timers/promises";

/**
 * 외부 서버 요청 사이의 속도 제한용 무작위 대기(설계서 F5: 1~3초).
 * 화면 요소를 기다리는 용도로 쓰지 않는다. 화면 대기는 waitFor를 쓴다.
 */
export async function politeDelay(minMs: number, maxMs: number): Promise<void> {
  await wait(minMs + Math.floor(Math.random() * (maxMs - minMs + 1)));
}

/** 식별자를 앞 2자만 남기고 가린다. 보고서·로그에 계정 식별자를 그대로 남기지 않기 위함. */
export function maskId(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.min(6, value.length - 2))}`;
}

/**
 * 다시 실행해도 결과가 같은 작업(페이지 열기, 글 조회 등)만 재시도한다.
 * 사진 업로드·저장처럼 반복하면 중복이 생기는 작업에는 쓰지 않는다.
 * shouldRetry가 false를 돌려주는 오류(세션 만료, 발행 차단 등)는 곧바로 던진다.
 */
export async function withRetry<T>(
  retries: number,
  fn: (attempt: number) => Promise<T>,
  shouldRetry: (err: unknown) => boolean = () => true,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err)) break;
    }
  }
  throw lastErr;
}

/** 오류를 사용자용 한 줄 메시지로 바꾼다. 스택 추적은 포함하지 않는다. */
export function errorSummary(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message.split("\n")[0]}`;
  return "알 수 없는 오류";
}
