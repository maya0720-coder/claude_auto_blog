"use client";

import { KIND_TEXT } from "../lib/jobs/reviewKinds";
import type { PlaceResearch, ReviewKind } from "../lib/jobs/types";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** AI가 웹에서 찾은 장소·제품 정보와 출처. 원고의 사실 정보는 여기 있는 것만 쓰인다. */
export function ResearchPanel({ research, kind }: { research?: PlaceResearch | undefined; kind: ReviewKind }) {
  const what = KIND_TEXT[kind].short;
  return (
    <section className="card" aria-labelledby="research-title">
      <details open>
        <summary>
          <h2 className="card-title" id="research-title">조사한 {what} 정보</h2>
          <span className="hint">{research ? `${research.facts.length}개` : "없음"}</span>
        </summary>
        {!research ? (
          <p className="hint">조사 결과가 없습니다. 원고에는 사실 정보(주소·가격 등)가 들어가지 않았습니다.</p>
        ) : (
          <div className="stack-tight">
            <p className="hint">{research.summary}</p>
            {research.facts.length > 0 && (
              <dl className="facts">
                {research.facts.map((f, i) => (
                  <div key={i}>
                    <dt>{f.label}</dt>
                    <dd>
                      {f.value}
                      {f.source && (
                        <>
                          {" "}
                          <a href={f.source} target="_blank" rel="noopener noreferrer" className="source-link">
                            {host(f.source)}
                          </a>
                        </>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="hint">{new Date(research.checkedAt).toLocaleString("ko-KR")} 기준 · 가격·영업시간은 바뀔 수 있으니 발행 전에 확인해 주세요.</p>
          </div>
        )}
      </details>
    </section>
  );
}
