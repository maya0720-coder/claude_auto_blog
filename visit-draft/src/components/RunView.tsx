"use client";

import { useEffect } from "react";
import { STEP_LABELS, stepsFor } from "../lib/client/labels";
import type { UiStepStatus } from "../lib/client/runState";
import { useRunStream } from "../lib/client/useRunStream";
import type { RunKind } from "../lib/runs/types";

const ICON: Record<UiStepStatus, string> = { pending: "", running: "", ok: "✓", failed: "!", skipped: "–", warning: "!" };
const STATUS_TEXT: Record<UiStepStatus, string> = {
  pending: "대기",
  running: "진행 중",
  ok: "완료",
  failed: "실패",
  skipped: "건너뜀",
  warning: "확인 필요",
};

interface Props {
  runId: string;
  kind: RunKind;
  onFinished: (ok: boolean) => void;
  onBack: () => void;
}

/** 원고 만들기·임시저장 진행 상황 */
export function RunView({ runId, kind, onFinished, onBack }: Props) {
  const steps = stepsFor(kind);
  const state = useRunStream(runId, steps);

  useEffect(() => {
    if (state.phase === "done") onFinished(true);
  }, [state.phase, onFinished]);

  return (
    <section className="card" aria-labelledby="run-title" aria-live="polite">
      <h2 className="card-title" id="run-title">
        {kind === "generate" ? "후기 원고를 만들고 있어요" : "네이버에 임시저장하고 있어요"}
      </h2>
      {kind === "generate" && state.phase !== "error" && (
        <p className="hint">사진 수에 따라 2~5분 정도 걸립니다. 이 화면을 닫아도 작업은 계속되고, 다시 열면 이어서 보입니다.</p>
      )}
      {kind === "save" && state.phase !== "error" && (
        <p className="hint">크롬 창이 따로 열립니다. 작업이 끝날 때까지 그 창을 건드리지 말아 주세요. 발행은 하지 않습니다.</p>
      )}

      {state.attention && (
        <p className="notice notice-warning" role="alert">
          {state.attention}
        </p>
      )}

      <ol className="steps">
        {steps.map((step) => {
          const s = state.steps[step] ?? { status: "pending" as const };
          return (
            <li className="step" key={step}>
              <span className="step-icon" data-status={s.status} aria-hidden="true">
                {ICON[s.status]}
              </span>
              <div className="step-body">
                <span className="step-title">
                  {STEP_LABELS[step]?.title} <span className="hint">· {STATUS_TEXT[s.status]}</span>
                </span>
                <p className="step-detail">{s.message ?? STEP_LABELS[step]?.waiting}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {state.phase === "error" && (
        <>
          <p className="notice notice-danger" role="alert">
            {state.error}
          </p>
          <div className="actions">
            <button type="button" className="button button-secondary" onClick={() => onFinished(false)}>
              작업 화면으로
            </button>
            <button type="button" className="button button-ghost" onClick={onBack}>
              처음으로
            </button>
          </div>
        </>
      )}

      {state.logs.length > 0 && (
        <details>
          <summary>자세한 기록 보기</summary>
          <pre className="log">{state.logs.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}
