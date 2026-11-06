import { randomUUID } from "node:crypto";
import { errorSummary } from "../util/common";
import type { RunEvent, RunInfo, RunKind } from "./types";

export type RunTask = (emit: (e: RunEvent) => void) => Promise<void>;
export type RunState = "running" | "done" | "error";

export interface Run extends RunInfo {
  state: RunState;
  startedAt: string;
  events: RunEvent[];
}

export class RunBusyError extends Error {
  override name = "RunBusyError";
  constructor() {
    super("이미 진행 중인 작업이 있습니다. 끝난 뒤 다시 시도해 주세요.");
  }
}

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isValidRunId = (id: string) => RUN_ID.test(id);

/** 작업이 사용자에게 보여 줄 문구와 함께 실패할 때 쓴다. 그 밖의 오류는 일반 문구로 바꾼다. */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}

/**
 * 오래 걸리는 작업을 하나씩 실행한다(브라우저 프로필·API 사용량 때문에 동시에 하나만).
 * 진행 이벤트를 모아 두었다가, 늦게 연결한 화면에도 처음부터 다시 보내 준다.
 */
export class RunManager {
  private runs = new Map<string, Run>();
  private listeners = new Map<string, Set<(e: RunEvent) => void>>();
  private activeId: string | undefined;

  constructor(private readonly maxKeptRuns = 20) {}

  get active(): RunInfo | undefined {
    const run = this.activeId ? this.runs.get(this.activeId) : undefined;
    return run ? { runId: run.runId, jobId: run.jobId, kind: run.kind } : undefined;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  start(jobId: string, kind: RunKind, task: RunTask, onFinally: () => void = () => {}): Run {
    if (this.activeId) throw new RunBusyError();
    const run: Run = { runId: randomUUID(), jobId, kind, state: "running", startedAt: new Date().toISOString(), events: [] };
    this.runs.set(run.runId, run);
    this.activeId = run.runId;
    this.prune();

    const emit = (e: RunEvent) => {
      run.events.push(e);
      for (const fn of this.listeners.get(run.runId) ?? []) fn(e);
    };

    void task(emit)
      .then(() => {
        run.state = "done";
        emit({ type: "done" });
      })
      .catch((err: unknown) => {
        run.state = "error";
        const message = err instanceof UserFacingError ? err.message : `처리 중 오류가 발생했습니다. (${errorSummary(err)})`;
        emit({ type: "error", message });
      })
      .finally(() => {
        this.activeId = undefined;
        try {
          onFinally();
        } catch (err) {
          console.error(`[runManager] 정리 실패: ${errorSummary(err)}`);
        }
      });
    return run;
  }

  /** 지금까지의 이벤트를 먼저 보내고, 이후 이벤트를 계속 전달한다. 해제 함수를 돌려준다. */
  subscribe(id: string, fn: (e: RunEvent) => void): () => void {
    const run = this.runs.get(id);
    if (!run) throw new Error("실행 기록이 없습니다.");
    for (const e of run.events) fn(e);
    const set = this.listeners.get(id) ?? new Set();
    set.add(fn);
    this.listeners.set(id, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  private prune(): void {
    const finished = [...this.runs.values()].filter((r) => r.state !== "running");
    const excess = this.runs.size - this.maxKeptRuns;
    for (const r of finished.slice(0, Math.max(0, excess))) {
      this.runs.delete(r.runId);
      this.listeners.delete(r.runId);
    }
  }
}
