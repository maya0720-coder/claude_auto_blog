import { isValidJobId } from "../../../../../lib/jobs/store";
import { jsonError, rejectNonLocal, serverContext } from "../../../../../lib/server/context";
import { startSave } from "../../../../../lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 네이버 임시저장 시작(발행은 하지 않음) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const { id } = await params;
  const ctx = serverContext();
  const job = isValidJobId(id) ? ctx.jobs.read(id) : undefined;
  if (!job) return jsonError(404, "작업을 찾을 수 없습니다.");
  if (!job.draft) return jsonError(409, "저장할 원고가 없습니다.");
  return startSave(ctx, id);
}
