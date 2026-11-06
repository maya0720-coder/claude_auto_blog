/** 오래 걸리는 작업(원고 만들기·임시저장)의 진행 이벤트. 서버와 화면이 함께 쓴다. */

export type StepStatus = "running" | "ok" | "failed" | "skipped" | "warning";
export type RunKind = "generate" | "save";

export type RunEvent =
  | { type: "log"; message: string }
  /** 사용자가 직접 해야 할 일(네이버 로그인 등) */
  | { type: "attention"; message: string }
  | { type: "step"; step: string; status: StepStatus; message?: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface RunInfo {
  runId: string;
  jobId: string;
  kind: RunKind;
}
