"use client";

import type { Job } from "../lib/jobs/types";

/** AI 사진 분석 결과: 사진마다 종류·설명·읽은 글자. 원고의 사진 배치·설명은 이 분석을 바탕으로 쓴다 */
export function PhotoNotesPanel({ job, photoVersion }: { job: Job; photoVersion: string }) {
  const notes = job.photoNotes;
  return (
    <section className="card" aria-labelledby="notes-title">
      <details open={!!notes?.length && notes.length <= 6}>
        <summary>
          <h2 className="card-title" id="notes-title">AI 사진 분석</h2>
          <span className="hint">{notes ? `${notes.length}장` : "없음"}</span>
        </summary>
        {!notes?.length ? (
          <p className="hint">분석 결과가 없습니다. 원고는 AI가 사진을 직접 보고 썼습니다.</p>
        ) : (
          <ul className="notes">
            {notes.map((n) => (
              <li key={n.photoId} className="note">
                <img src={`/api/jobs/${job.id}/photos/${n.photoId}?v=${encodeURIComponent(photoVersion)}`} alt={n.caption || `사진 ${n.photoId}`} loading="lazy" />
                <div className="note-body">
                  <span className="note-meta">
                    <span className="tag">{n.photoId}</span>
                    <span className="tag">{n.category}</span>
                  </span>
                  <span>{n.description}</span>
                  {n.visibleText && <span className="hint">읽은 글자: {n.visibleText}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
