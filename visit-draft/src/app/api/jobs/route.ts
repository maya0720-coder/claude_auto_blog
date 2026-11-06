import { InvalidImageError } from "../../../lib/images/prepare";
import { checkFiles, createJob, JobInputError, parsePayload } from "../../../lib/jobs/create";
import { InvalidBlogUrlError } from "../../../lib/naver/blogUrl";
import { jsonError, jsonOk, rejectNonLocal, serverContext } from "../../../lib/server/context";
import { startGenerate } from "../../../lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORM_OVERHEAD_BYTES = 1024 * 1024;

/** 최근 작업 목록 */
export async function GET(req: Request): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  return jsonOk({ jobs: serverContext().jobs.list() });
}

/** 새 작업: multipart(payload JSON + images[]) → 작업 생성 후 원고 만들기 시작 */
export async function POST(req: Request): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const ctx = serverContext();
  if (ctx.runs.active) return jsonError(409, "이미 진행 중인 작업이 있습니다. 끝난 뒤 다시 시도해 주세요.");

  const length = Number(req.headers.get("content-length") ?? "0");
  const maxBytes = ctx.cfg.images.maxBytes * ctx.cfg.images.jobMaxCount + FORM_OVERHEAD_BYTES;
  if (!Number.isFinite(length) || length <= 0 || length > maxBytes) return jsonError(413, "보낸 사진 용량이 너무 큽니다.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "요청 형식이 올바르지 않습니다.");
  }
  const payload = form.get("payload");
  if (typeof payload !== "string" || payload.length > 50_000) return jsonError(400, "요청 형식이 올바르지 않습니다.");
  const files = form.getAll("images").filter((v): v is File => v instanceof File);

  try {
    const input = parsePayload(payload, ctx.sel);
    const exts = checkFiles(files, ctx.cfg.images);
    const job = await createJob(input, files, exts, ctx.jobs);
    return startGenerate(ctx, job.id, true);
  } catch (err) {
    if (err instanceof JobInputError || err instanceof InvalidImageError || err instanceof InvalidBlogUrlError) {
      return jsonError(400, err.message);
    }
    console.error(`[api/jobs] 작업 생성 실패: ${(err as Error).name}`);
    return jsonError(500, "작업을 만들지 못했습니다.");
  }
}
