import { loadDefaults, loadSelectors } from "../config/load";
import type { Defaults, Selectors } from "../config/schema";
import { JobStore } from "../jobs/store";
import { RunManager } from "../runs/runManager";
import { checkLocalRequest } from "./localGuard";

/**
 * 서버 공용 객체. 개발 모드에서 모듈이 다시 로드돼도 상태가 사라지지 않도록 globalThis에 둔다.
 * 설정 파일 오류는 첫 요청에서 바로 실패시킨다. 처음 만들 때 보관 기간이 지난 작업을 지운다.
 */
export interface ServerContext {
  sel: Selectors;
  cfg: Defaults;
  runs: RunManager;
  jobs: JobStore;
}

const KEY = Symbol.for("visit-draft.server-context.v2");
type Holder = { [KEY]?: ServerContext };

export function serverContext(): ServerContext {
  const g = globalThis as Holder;
  if (!g[KEY]) {
    const cfg = loadDefaults();
    const jobs = new JobStore(cfg.jobs);
    const removed = jobs.purgeOlderThan(cfg.jobs.retentionDays);
    if (removed > 0) console.log(`[server] 보관 기간이 지난 작업 ${removed}개를 지웠습니다.`);
    g[KEY] = { sel: loadSelectors(), cfg, runs: new RunManager(), jobs };
  }
  return g[KEY];
}

/** 로컬 요청이 아니면 403 응답을, 맞으면 undefined를 돌려준다. */
export function rejectNonLocal(req: Request): Response | undefined {
  const result = checkLocalRequest(req.headers, req.method, serverContext().cfg.app.port);
  return result.ok ? undefined : jsonError(result.status, result.message);
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonOk(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
