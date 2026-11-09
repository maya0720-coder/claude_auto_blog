import { ConfirmedPointsError, validateConfirmedPoints } from "../../../../../lib/jobs/reviewPoints";
import { isValidJobId } from "../../../../../lib/jobs/store";
import { jsonError, rejectNonLocal, serverContext } from "../../../../../lib/server/context";
import { isJobBusy, readJson, startGenerate } from "../../../../../lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 원고 다시 만들기. body: { full?: boolean, confirmedPoints?: string[] }
 * full이면 사진·문체·조사부터 다시 한다. confirmedPoints는 "나도 그랬다"고 체크한 후기 포인트(조사 결과에 있는 문구만 받음).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const { id } = await params;
  const ctx = serverContext();
  const job = isValidJobId(id) ? ctx.jobs.read(id) : undefined;
  if (!job) return jsonError(404, "작업을 찾을 수 없습니다.");
  let body: { full?: unknown; confirmedPoints?: unknown };
  try {
    body = ((await readJson(req, 20_000)) ?? {}) as typeof body;
  } catch {
    return jsonError(400, "요청 형식이 올바르지 않습니다.");
  }
  const full = body.full === true;
  if (body.confirmedPoints !== undefined) {
    if (isJobBusy(ctx, id)) return jsonError(409, "진행 중인 작업이 끝난 뒤 다시 시도해 주세요.");
    try {
      const confirmedPoints = validateConfirmedPoints(body.confirmedPoints, job);
      ctx.jobs.update(id, (j) => ({ ...j, confirmedPoints }));
    } catch (err) {
      if (err instanceof ConfirmedPointsError) return jsonError(400, err.message);
      throw err;
    }
  }
  return startGenerate(ctx, id, full);
}
