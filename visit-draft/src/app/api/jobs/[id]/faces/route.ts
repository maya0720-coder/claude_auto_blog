import { FACE_MODES, type FaceMode } from "../../../../../lib/config/schema";
import { renderCopies } from "../../../../../lib/images/process";
import { isValidJobId } from "../../../../../lib/jobs/store";
import { jsonError, jsonOk, rejectNonLocal, serverContext } from "../../../../../lib/server/context";
import { isJobBusy, readJson } from "../../../../../lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 얼굴 가리기 방식 바꾸기(모자이크/스티커/안 함). 이미 찾은 얼굴 위치로 사진 사본만 다시 만든다.
 * 이미 만든 원고 내용은 바뀌지 않는다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const { id } = await params;
  const ctx = serverContext();
  const job = isValidJobId(id) ? ctx.jobs.read(id) : undefined;
  if (!job) return jsonError(404, "작업을 찾을 수 없습니다.");
  if (isJobBusy(ctx, id) || job.status === "processing") return jsonError(409, "진행 중인 작업이 끝난 뒤 바꿀 수 있습니다.");

  let mode: FaceMode;
  try {
    const body = (await readJson(req, 1000)) as { mode?: unknown };
    if (!FACE_MODES.includes(body?.mode as FaceMode)) throw new Error("bad mode");
    mode = body.mode as FaceMode;
  } catch {
    return jsonError(400, "가리기 방식 값이 올바르지 않습니다.");
  }
  if (mode !== "none" && job.input.options.faceMode === "none") {
    return jsonError(409, "처음에 '가리지 않음'으로 만든 작업은 얼굴 위치 정보가 없습니다. 새로 만들어 주세요.");
  }
  for (const photo of job.photos) await renderCopies(ctx.jobs, id, photo, mode, ctx.cfg);
  const updated = ctx.jobs.update(id, (j) => ({ ...j, input: { ...j.input, options: { ...j.input.options, faceMode: mode } } }));
  return jsonOk({ job: updated });
}
