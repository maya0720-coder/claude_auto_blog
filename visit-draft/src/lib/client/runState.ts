/** 진행 상황 화면의 상태(순수 리듀서). 브라우저·테스트 양쪽에서 쓴다. */
import type { RunEvent, StepStatus } from "../runs/types";

export type Phase = "connecting" | "running" | "done" | "error";
export type UiStepStatus = StepStatus | "pending";

export interface RunUiState {
  phase: Phase;
  steps: Record<string, { status: UiStepStatus; message?: string }>;
  logs: string[];
  attention?: string;
  error?: string;
}

export type RunAction = { type: "reset"; steps: readonly string[] } | { type: "event"; event: RunEvent } | { type: "failed"; message: string };

const MAX_LOGS = 300;

export const initialRunState = (steps: readonly string[]): RunUiState => ({
  phase: "connecting",
  steps: Object.fromEntries(steps.map((s) => [s, { status: "pending" as UiStepStatus }])),
  logs: [],
});

const withoutAttention = (s: RunUiState): RunUiState => {
  const next = { ...s };
  delete next.attention;
  return next;
};

export function runReducer(state: RunUiState, action: RunAction): RunUiState {
  if (action.type === "reset") return initialRunState(action.steps);
  if (action.type === "failed") return { ...withoutAttention(state), phase: "error", error: action.message };

  const e = action.event;
  const base: RunUiState = state.phase === "connecting" ? { ...state, phase: "running" } : state;
  switch (e.type) {
    case "log":
      return { ...base, logs: [...base.logs, e.message].slice(-MAX_LOGS) };
    case "attention":
      return { ...base, attention: e.message, logs: [...base.logs, `★ ${e.message}`].slice(-MAX_LOGS) };
    case "step": {
      const next: RunUiState = {
        ...base,
        steps: { ...base.steps, [e.step]: { status: e.status, ...(e.message ? { message: e.message } : {}) } },
        logs: e.message ? [...base.logs, e.message].slice(-MAX_LOGS) : base.logs,
      };
      // 로그인 단계가 끝나면 로그인 안내를 내린다
      return e.step === "login" && e.status !== "running" ? withoutAttention(next) : next;
    }
    case "done":
      return { ...withoutAttention(base), phase: "done" };
    case "error":
      return { ...withoutAttention(base), phase: "error", error: e.message };
  }
}
