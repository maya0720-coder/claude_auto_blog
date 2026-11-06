import { jsonOk, rejectNonLocal, serverContext } from "../../../../lib/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 진행 중인 작업. 화면을 새로 고쳐도 진행 상황에 다시 연결할 수 있게 한다. */
export async function GET(req: Request): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  return jsonOk({ run: serverContext().runs.active ?? null });
}
