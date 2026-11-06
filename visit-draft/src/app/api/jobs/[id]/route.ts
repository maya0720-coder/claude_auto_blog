import { isValidJobId } from "../../../../lib/jobs/store";
import { checkDraft, draftSchema, type Job } from "../../../../lib/jobs/types";
import { jsonError, jsonOk, rejectNonLocal, serverContext, type ServerContext } from "../../../../lib/server/context";
import { isJobBusy, readJson } from "../../../../lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type Loaded = { error: Response } | { ctx: ServerContext; job: Job };

async function loadJob(req: Request, params: Ctx["params"]): Promise<Loaded> {
  const denied = rejectNonLocal(req);
  if (denied) return { error: denied };
  const { id } = await params;
  const ctx = serverContext();
  const job = isValidJobId(id) ? ctx.jobs.read(id) : undefined;
  if (!job) return { error: jsonError(404, "작업을 찾을 수 없습니다.") };
  return { ctx, job };
}

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const r = await loadJob(req, params);
  if ("error" in r) return r.error;
  return jsonOk({ job: r.job });
}

/** 사용자가 고친 원고 저장. 사진 ID·형식을 다시 검증한다. */
export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const r = await loadJob(req, params);
  if ("error" in r) return r.error;
  if (isJobBusy(r.ctx, r.job.id)) return jsonError(409, "진행 중인 작업이 끝난 뒤 고칠 수 있습니다.");
  if (!r.job.draft) return jsonError(409, "아직 원고가 없습니다.");

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    return jsonError(400, "요청 형식이 올바르지 않습니다.");
  }
  const parsed = draftSchema.safeParse((body as { draft?: unknown })?.draft);
  if (!parsed.success) return jsonError(400, `원고 형식이 올바르지 않습니다: ${parsed.error.issues[0]?.message ?? ""}`);
  const problems = checkDraft(parsed.data, r.job.photos.map((p) => p.id)).filter((p) => !p.startsWith("빠진 사진"));
  if (problems.length) return jsonError(400, problems.join(" "));
  const job = r.ctx.jobs.update(r.job.id, (j) => ({ ...j, draft: parsed.data }));
  return jsonOk({ job });
}

/** 작업과 사진을 모두 지운다. */
export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const r = await loadJob(req, params);
  if ("error" in r) return r.error;
  if (isJobBusy(r.ctx, r.job.id)) return jsonError(409, "진행 중인 작업은 지울 수 없습니다.");
  r.ctx.jobs.delete(r.job.id);
  return jsonOk({ ok: true });
}
