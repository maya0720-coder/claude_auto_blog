"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/client/api";
import type { FaceMode } from "../lib/config/schema";
import type { RunInfo, RunKind } from "../lib/runs/types";
import { AppMenu } from "./AppMenu";
import { JobList } from "./JobList";
import { JobView } from "./JobView";
import { NewJobForm } from "./NewJobForm";
import type { PhotoLimits } from "./PhotoPicker";
import { RunView } from "./RunView";
import { PROVIDER_LABELS, SettingsPanel, type Settings } from "./SettingsPanel";

type View = { name: "home" } | { name: "run"; runId: string; jobId: string; kind: RunKind } | { name: "job"; jobId: string };

interface Props {
  limits: PhotoLimits;
  defaultFaceMode: FaceMode;
  retentionDays: number;
}

/** 화면 전체: 새 후기 입력 → 진행 → 원고 확인·수정 → 임시저장 */
export function App({ limits, defaultFaceMode, retentionDays }: Props) {
  const [view, setView] = useState<View>({ name: "home" });
  const [showSettings, setShowSettings] = useState(false);
  const [ai, setAi] = useState<Settings["ai"]>();
  const keyMissing = !!ai && !ai.keys[ai.provider].configured;

  // 진행 중인 작업이 있으면 그 화면으로, API 키가 없으면 설정을 먼저 연다
  useEffect(() => {
    api
      .get<{ run: RunInfo | null }>("/api/runs/active")
      .then(({ run }) => {
        if (run) setView({ name: "run", ...run });
      })
      .catch(() => {});
    api
      .get<Settings>("/api/settings")
      .then((s) => {
        setAi(s.ai);
        if (!s.ai.keys[s.ai.provider].configured) setShowSettings(true);
      })
      .catch(() => {});
  }, []);

  const goHome = useCallback(() => setView({ name: "home" }), []);
  const running = view.name === "run";
  const onFinished = useCallback(() => setView((v) => (v.name === "run" ? { name: "job", jobId: v.jobId } : v)), []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={goHome} disabled={running}>
            <span className="brand-mark" aria-hidden="true">방</span>
            방문기록 <span className="brand-sub">블로그 후기 자동 작성</span>
          </button>
          <span className="topbar-tools">
            {ai && (
              <button type="button" className="provider-chip" onClick={() => setShowSettings(true)} title="글을 쓸 AI 설정">
                <span className="dot" data-off={keyMissing} aria-hidden="true" />
                {PROVIDER_LABELS[ai.provider]} · {ai.model}
              </button>
            )}
            <button type="button" className="button button-ghost button-small" onClick={() => setShowSettings(true)}>
              설정
            </button>
            <AppMenu disabled={running} />
          </span>
        </div>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onChanged={(s) => setAi(s.ai)} />}

      <main className="page">
        {keyMissing && !showSettings && (
          <p className="notice notice-warning">{PROVIDER_LABELS[ai!.provider]} API 키가 없습니다. 오른쪽 위 [설정]에서 먼저 입력해 주세요.</p>
        )}

        {view.name === "home" && (
          <NewJobForm
            limits={limits}
            defaultFaceMode={defaultFaceMode}
            provider={ai?.provider ?? "google"}
            onStarted={(jobId, runId) => setView({ name: "run", runId, jobId, kind: "generate" })}
            recent={<JobList retentionDays={retentionDays} onOpen={(jobId) => setView({ name: "job", jobId })} />}
          />
        )}
        {view.name === "run" && (
          <div className="narrow">
            <RunView key={view.runId} runId={view.runId} kind={view.kind} onFinished={onFinished} onBack={goHome} />
          </div>
        )}
        {view.name === "job" && (
          <>
            <button type="button" className="link-button" onClick={goHome}>← 새 후기 만들기</button>
            <JobView key={view.jobId} jobId={view.jobId} onBack={goHome} onRun={(runId, kind) => setView({ name: "run", runId, jobId: view.jobId, kind })} />
          </>
        )}
      </main>
    </>
  );
}
