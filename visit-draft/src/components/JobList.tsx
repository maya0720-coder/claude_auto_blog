"use client";

import { useEffect, useState } from "react";
import { api, errorText } from "../lib/client/api";
import { STATUS_LABELS } from "../lib/client/labels";
import { KIND_TEXT } from "../lib/jobs/reviewKinds";
import type { JobSummary } from "../lib/jobs/types";

const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

/** 최근 작업 목록(보관 기간이 지나면 자동 삭제됨) */
export function JobList({ onOpen, retentionDays }: { onOpen: (jobId: string) => void; retentionDays: number }) {
  const [jobs, setJobs] = useState<JobSummary[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .get<{ jobs: JobSummary[] }>("/api/jobs")
      .then((r) => setJobs(r.jobs))
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!jobs || jobs.length === 0) return null;

  return (
    <section className="card" aria-labelledby="jobs-title">
      <h2 className="card-title" id="jobs-title">최근 작업</h2>
      <ul className="job-list">
        {jobs.map((j) => (
          <li key={j.id}>
            <button type="button" className="job-item" onClick={() => onOpen(j.id)}>
              <span className="job-main">
                <strong>{j.title ?? j.placeName}</strong>
                <span className="hint">
                  {KIND_TEXT[j.kind].short} · {j.placeName} · {fmt(j.createdAt)}
                </span>
              </span>
              <span className="badge" data-status={j.status}>
                {STATUS_LABELS[j.status]}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">작업과 사진은 이 PC에만 있고, {retentionDays}일이 지나면 자동으로 지워집니다.</p>
    </section>
  );
}
