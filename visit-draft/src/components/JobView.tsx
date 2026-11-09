"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../lib/client/api";
import { FACE_MODE_LABELS, STATUS_LABELS } from "../lib/client/labels";
import type { FaceMode } from "../lib/config/schema";
import { withPlaceInfo } from "../lib/jobs/placeInfo";
import { KIND_TEXT } from "../lib/jobs/reviewKinds";
import { draftToPlainText, type Job } from "../lib/jobs/types";
import type { RunKind } from "../lib/runs/types";
import { DraftEditor } from "./DraftEditor";
import { PhotoNotesPanel } from "./PhotoNotesPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ReviewPointsPanel } from "./ReviewPointsPanel";
import { Segmented } from "./Segmented";
import { SourcesPanel } from "./SourcesPanel";

interface Props {
  jobId: string;
  onRun: (runId: string, kind: RunKind) => void;
  onBack: () => void;
}

/** 작업 화면(2단): 왼쪽 원고 확인·수정, 오른쪽 임시저장·다시 쓰기 등 도구와 사진 분석·조사 결과 */
export function JobView({ jobId, onRun, onBack }: Props) {
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ job: Job }>(`/api/jobs/${jobId}`)
      .then((r) => setJob(r.job))
      .catch((e: unknown) => setError(errorText(e)));
  }, [jobId]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const start = (path: string, body: unknown, kind: RunKind) =>
    act(async () => {
      const r = await api.post<{ runId: string }>(`/api/jobs/${jobId}/${path}`, body);
      onRun(r.runId, kind);
    });

  const copy = () =>
    act(async () => {
      await navigator.clipboard.writeText(draftToPlainText(job!.draft!));
      setNotice("본문을 복사했습니다. 사진은 화면의 사진을 저장해 직접 올려 주세요.");
    });

  const changeFaces = (mode: FaceMode) =>
    act(async () => {
      const r = await api.post<{ job: Job }>(`/api/jobs/${jobId}/faces`, { mode });
      setJob(r.job);
    });

  const addPlaceInfo = () =>
    act(async () => {
      const r = await api.put<{ job: Job }>(`/api/jobs/${jobId}`, { draft: withPlaceInfo(job!.draft!, job!) });
      setJob(r.job);
      setNotice("원고 끝에 방문 정보(주소·운영시간·네이버 지도 링크)를 넣었습니다.");
    });

  const remove = () => {
    if (!window.confirm("이 작업과 사진을 모두 지울까요? 네이버에 저장된 글은 지워지지 않습니다.")) return;
    void act(async () => {
      await api.del(`/api/jobs/${jobId}`);
      onBack();
    });
  };

  if (error && !job) return <p className="notice notice-danger" role="alert">{error}</p>;
  if (!job) return <p className="hint">불러오는 중…</p>;

  const hasDraft = !!job.draft;
  const photoVersion = `${job.input.options.faceMode}-${job.updatedAt}`;
  const k = KIND_TEXT[job.input.kind];
  const template = job.input.template;
  return (
    <div className="layout">
      <div className="col">
        {hasDraft ? (
          <DraftEditor job={job} photoVersion={photoVersion} onSaved={setJob} onDirtyChange={setDirty} />
        ) : (
          <section className="card">
            <h2 className="card-title">원고가 아직 없습니다</h2>
            <p className="hint">오른쪽의 [다시 시도]로 원고를 다시 만들 수 있습니다.</p>
          </section>
        )}
        {hasDraft && (
          <ReviewPointsPanel job={job} disabled={busy || dirty} onRewrite={(confirmedPoints) => void start("generate", { full: false, confirmedPoints }, "generate")} />
        )}
        <SourcesPanel job={job} onAddInfo={() => void addPlaceInfo()} disabled={busy || dirty} />
      </div>

      <div className="col sticky">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{job.input.place.name}</h2>
            <span className="badge" data-status={job.status}>{STATUS_LABELS[job.status]}</span>
          </div>
          <p className="hint">
            {k.label} · 사진 {job.photos.length}장 · {job.input.options.length === "long" ? "긴 글" : "중간 글"}
            {template ? ` · 참고 블로그 ${template.blogId}` : ""}
          </p>
          {job.status === "failed" && <p className="notice notice-danger">{job.error ?? "원고를 만들지 못했습니다."}</p>}
          {job.status === "saved" && job.saved && (
            <div className="notice notice-success">
              <strong>네이버에 임시저장했습니다</strong> ({new Date(job.saved.at).toLocaleString("ko-KR")})
              <ol className="checklist">
                <li>글쓰기 화면의 &lsquo;저장 글&rsquo; 목록에서 글을 열어 확인하세요.</li>
                <li>사진·카테고리{job.input.categoryNo ? `(${job.input.categoryNo}번)` : ""}를 확인한 뒤 직접 발행하세요. 이 앱은 발행하지 않습니다.</li>
              </ol>
              {job.saved.screenshot && (
                <details>
                  <summary>저장 직후 화면 보기</summary>
                  <img className="screenshot" src={`/api/jobs/${job.id}/screenshot?v=${job.updatedAt}`} alt="임시저장 직후 화면" />
                </details>
              )}
            </div>
          )}
          {notice && <p className="notice notice-info" role="status">{notice}</p>}
          {error && <p className="notice notice-danger" role="alert">{error}</p>}

          {hasDraft && (
            <button type="button" className="button button-primary button-lg button-block" disabled={busy || dirty} onClick={() => void start("save", {}, "save")}>
              네이버에 임시저장
            </button>
          )}
          {dirty && <p className="hint">고친 내용을 먼저 저장해 주세요(원고 아래 [고친 내용 저장]).</p>}
          <div className="action-grid">
            {hasDraft && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void copy()}>본문 복사</button>}
            {hasDraft && (
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => window.confirm("지금 원고 대신 새 원고를 쓸까요? (사진 분석·조사 결과는 그대로)") && void start("generate", { full: false }, "generate")}>
                원고 다시 쓰기
              </button>
            )}
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void start("generate", { full: true }, "generate")}>
              {hasDraft ? "처음부터 다시" : "다시 시도"}
            </button>
            <button type="button" className="button button-danger" disabled={busy} onClick={remove}>작업 삭제</button>
          </div>

          {job.input.options.faceMode !== "none" && hasDraft && (
            <>
              <hr className="divider" />
              <div className="field">
                <span className="label">얼굴 가리기</span>
                <Segmented label="얼굴 가리기 방식" value={job.input.options.faceMode} disabled={busy} onChange={(m) => void changeFaces(m)} options={Object.entries(FACE_MODE_LABELS) as [FaceMode, string][]} />
                <p className="hint">찾은 얼굴 {job.photos.reduce((n, p) => n + p.faces.length, 0)}명 · 바꾸면 사진만 다시 만들고 원고는 그대로입니다.</p>
              </div>
            </>
          )}
        </section>

        <PhotoNotesPanel job={job} photoVersion={photoVersion} />
        <ResearchPanel research={job.research} kind={job.input.kind} />
      </div>
    </div>
  );
}
