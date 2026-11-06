/**
 * 로컬 전용 요청 검사.
 * - Host 헤더가 루프백 주소가 아니면 거부한다(DNS 리바인딩 방지).
 * - 상태를 바꾸는 요청은 Origin이 이 앱이어야 한다(다른 웹사이트에서 보내는 요청 위조 방지).
 */
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost"];

export function allowedOrigins(port: number): string[] {
  return LOOPBACK_HOSTS.map((h) => `http://${h}:${port}`);
}

export type GuardResult = { ok: true } | { ok: false; status: 403; message: string };

export function checkLocalRequest(
  headers: Pick<Headers, "get">,
  method: string,
  port: number,
): GuardResult {
  const host = headers.get("host") ?? "";
  if (!LOOPBACK_HOSTS.map((h) => `${h}:${port}`).includes(host.toLowerCase())) {
    return { ok: false, status: 403, message: "허용되지 않은 접근입니다." };
  }
  const safeMethod = method === "GET" || method === "HEAD";
  if (!safeMethod) {
    const origin = headers.get("origin");
    if (!origin || !allowedOrigins(port).includes(origin.toLowerCase())) {
      return { ok: false, status: 403, message: "허용되지 않은 요청 출처입니다." };
    }
  }
  return { ok: true };
}
