"use client";

import { useEffect, useState } from "react";
import { KIND_TEXT } from "../lib/jobs/reviewKinds";
import { REVIEW_POINT_LABELS } from "../lib/jobs/reviewPoints";
import type { Job } from "../lib/jobs/types";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

interface Props {
  job: Job;
  disabled: boolean;
  /** 체크한 포인트로 원고를 다시 쓴다 */
  onRewrite: (confirmed: string[]) => void;
}

/**
 * 다른 방문자·사용자 후기에서 자주 나온 포인트. 사용자가 실제로 겪은 것만 체크하면 그 내용은 내 경험으로,
 * 나머지는 "후기를 보니 ~" 같은 정보·팁으로 원고에 들어간다(남의 경험을 내 경험으로 쓰지 않음).
 */
export function ReviewPointsPanel({ job, disabled, onRewrite }: Props) {
  const points = job.research?.reviewPoints ?? [];
  const saved = job.confirmedPoints ?? [];
  const [checked, setChecked] = useState<string[]>(saved);
  useEffect(() => setChecked(job.confirmedPoints ?? []), [job.confirmedPoints]);

  const who = job.input.kind === "product" ? "사용자" : "방문자";
  const changed = checked.length !== saved.length || checked.some((c) => !saved.includes(c));
  const toggle = (p: string) => setChecked((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]));

  return (
    <section className="card" aria-labelledby="points-title">
      <div className="card-head">
        <h2 className="card-title" id="points-title">다른 {who} 후기에서 많이 나온 이야기</h2>
        <span className="hint">{points.length ? `${points.length}개` : "없음"}</span>
      </div>
      {points.length === 0 ? (
        <p className="hint">
          아직 모은 후기 포인트가 없습니다. 이 기능 이전에 조사한 작업이면 [처음부터 다시]로 {KIND_TEXT[job.input.kind].short} 후기를 함께 조사할 수 있습니다.
        </p>
      ) : (
        <>
          <p className="hint">
            <strong>나도 그랬던 것만 체크</strong>하세요. 체크한 내용은 내 경험으로, 체크하지 않은 내용은 &ldquo;후기를 보니 ~라고 해요&rdquo; 같은 팁으로 글에 들어갑니다.
          </p>
          <ul className="point-list">
            {points.map((p) => (
              <li key={p.point}>
                <label className="point-item">
                  <input type="checkbox" checked={checked.includes(p.point)} disabled={disabled} onChange={() => toggle(p.point)} />
                  <span>
                    <span className="tag" data-type={p.type}>{REVIEW_POINT_LABELS[p.type]}</span> {p.point}
                    {p.sources.length > 0 && (
                      <span className="point-sources">
                        {p.sources.map((u, i) => (
                          <a key={u} href={u} target="_blank" rel="noopener noreferrer" title={u}>
                            후기{i + 1} · {host(u)}
                          </a>
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row-between">
            <span className="hint">체크 {checked.length}개{changed ? " · 아직 원고에 반영 안 됨" : ""}</span>
            <button
              type="button"
              className="button button-primary"
              disabled={disabled}
              onClick={() => window.confirm("체크한 내용을 반영해 원고를 새로 쓸까요? 직접 고친 내용은 사라집니다.") && onRewrite(checked)}
            >
              체크한 내용으로 원고 다시 쓰기
            </button>
          </div>
        </>
      )}
    </section>
  );
}
