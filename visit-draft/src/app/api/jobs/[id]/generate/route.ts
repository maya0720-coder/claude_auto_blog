import { isValidJobId } from "../../../../../lib/jobs/store";
import { jsonError, rejectNonLocal, serverContext } from "../../../../../lib/server/context";
import { readJson, startGenerate } from "../../../../../lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 원고 다시 만들기. body: { full?: boolean } — full이면 사진·문체·조사부터 다시 한다. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const { id } = await params;
  const ctx = serverContext();
  if (!isValidJobId(id) || !ctx.jobs.read(id)) return jsonError(404, "작업을 찾을 수 없습니다.");
  let full = false;
  try {
    full = ((await readJson(req, 1000)) as { full?: unknown })?.full === true;
  } catch {
    return jsonError(400, "요청 형식이 올바르지 않습니다.");
  }
  return startGenerate(ctx, id, full);
}
