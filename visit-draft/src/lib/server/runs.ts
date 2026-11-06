/** API에서 오래 걸리는 작업을 시작하는 공통 함수 */
import { runGenerate } from "../jobs/generate";
import { runSave } from "../jobs/saveToNaver";
import { RunBusyError } from "../runs/runManager";
import { jsonError, jsonOk, type ServerContext } from "./context";

export function startGenerate(ctx: ServerContext, jobId: string, full: boolean): Response {
  try {
    const run = ctx.runs.start(jobId, "generate", (emit) => runGenerate(jobId, ctx.jobs, ctx.cfg, ctx.sel, emit, { full }));
    return jsonOk({ jobId, runId: run.runId }, 202);
  } catch (err) {
    if (err instanceof RunBusyError) return jsonError(409, err.message);
    throw err;
  }
}

export function startSave(ctx: ServerContext, jobId: string): Response {
  try {
    const run = ctx.runs.start(jobId, "save", (emit) => runSave(jobId, ctx.jobs, ctx.cfg, ctx.sel, emit));
    return jsonOk({ jobId, runId: run.runId }, 202);
  } catch (err) {
    if (err instanceof RunBusyError) return jsonError(409, err.message);
    throw err;
  }
}

/** 이 작업이 지금 실행 중이면 수정·삭제를 막는다. */
export const isJobBusy = (ctx: ServerContext, jobId: string) => ctx.runs.active?.jobId === jobId;

/** 요청 본문 JSON을 크기 제한과 함께 읽는다. */
export async function readJson(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new RangeError("too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new RangeError("too large");
  return JSON.parse(text);
}
