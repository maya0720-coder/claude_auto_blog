import { jsonError, rejectNonLocal, serverContext } from "../../../../lib/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 응답을 보낸 뒤 서버를 끄기까지의 여유 시간 */
const EXIT_DELAY_MS = 300;

/**
 * 화면의 [앱 종료] 버튼. 백그라운드로 실행된 앱을 사용자가 끌 수 있게 한다.
 * 로컬 요청만 받고(Origin 검사 포함), 실행 중인 작업이 있으면 끄지 않는다.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  if (serverContext().runs.active) {
    return jsonError(409, "실행 중인 작업이 끝난 뒤에 종료해 주세요.");
  }
  setTimeout(() => process.exit(0), EXIT_DELAY_MS);
  return Response.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
