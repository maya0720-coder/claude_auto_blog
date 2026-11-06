/** PoC 실행 결과·진행 이벤트 타입. 서버와 브라우저가 함께 쓰므로 Node 전용 모듈을 가져오지 않는다. */

export const POC_STEPS = ["1-session", "2-read-posts", "3-4-save-draft"] as const;
export type PocStepName = (typeof POC_STEPS)[number];
export type StepStatus = "running" | "ok" | "failed" | "skipped";

export type StepDetail = Record<string, unknown>;

export interface StepResult {
  step: PocStepName;
  status: Exclude<StepStatus, "running">;
  detail?: StepDetail;
  error?: string;
  /** 프로젝트 폴더 기준 상대 경로 */
  debugSnapshot?: string;
}

export interface PocReport {
  createdAt: string;
  blog: string;
  categoryRequested: boolean;
  results: StepResult[];
  /** 프로젝트 폴더 기준 상대 경로 */
  resultFile: string;
}

export type PocEvent =
  | { type: "log"; message: string }
  | { type: "attention"; message: string }
  | { type: "step"; step: PocStepName; status: StepStatus; error?: string };

/** 웹 진행 상황 스트림(SSE)으로 보내는 이벤트 */
export type RunEvent = PocEvent | { type: "done"; report: PocReport } | { type: "error"; message: string };

export const reportHasFailure = (r: PocReport) => r.results.some((x) => x.status === "failed");
