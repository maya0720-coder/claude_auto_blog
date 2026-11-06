"use client";

/** 화면 → 로컬 앱 서버 호출 도우미. 서버가 꺼져 있으면 안내 문구로 바꾼다. */

export const APP_DOWN_MESSAGE =
  "앱이 꺼져 있습니다. 바탕화면의 '방문기록' 아이콘으로 다시 실행한 뒤 이 화면을 새로 고쳐 주세요.";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(APP_DOWN_MESSAGE, 0);
  }
  let body: unknown = undefined;
  try {
    body = await res.json();
  } catch {
    // 본문이 JSON이 아님
  }
  if (!res.ok) {
    const msg = (body as { error?: unknown } | undefined)?.error;
    throw new ApiError(typeof msg === "string" ? msg : "요청을 처리하지 못했습니다.", res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  del: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  form: <T>(url: string, form: FormData) => request<T>(url, { method: "POST", body: form }),
};

export const errorText = (err: unknown) => (err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
