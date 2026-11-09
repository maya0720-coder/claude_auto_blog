"use client";

import { PLACE_INFO_HEADER, placeLinks } from "../lib/jobs/placeInfo";
import type { Job } from "../lib/jobs/types";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** 긴 주소는 가운데를 줄여 보여 준다(링크는 전체 주소) */
const shortUrl = (u: string) => {
  const s = u.replace(/^https?:\/\/(www\.)?/, "");
  return s.length > 70 ? `${s.slice(0, 45)}…${s.slice(-20)}` : s;
};

interface Props {
  job: Job;
  /** 방문 정보 블록이 없는 예전 원고에 블록을 넣는다 */
  onAddInfo: () => void;
  disabled: boolean;
}

/**
 * 원고 아래 "참고한 사이트": 원고의 사실 정보가 어디서 왔는지 확인용.
 * 이 목록은 앱에서만 보이고 네이버 임시저장에는 넣지 않는다.
 * 장소 후기면 원고 끝에 자동으로 넣은 네이버 지도·예약 링크도 여기서 눌러 확인할 수 있다.
 */
export function SourcesPanel({ job, onAddInfo, disabled }: Props) {
  const research = job.research;
  const links = job.input.kind === "place" ? placeLinks(job) : undefined;
  const sources = research?.sources ?? [];
  const hasInfo = !!job.draft?.blocks.some((b) => b.type === "text" && b.text.startsWith(PLACE_INFO_HEADER));
  const reviewUrls = [...new Set(research?.reviewPoints?.flatMap((p) => p.sources) ?? [])];
  const factsOf = (u: string) => research?.facts.filter((f) => f.source === u).map((f) => f.label) ?? [];

  return (
    <section className="card" aria-labelledby="sources-title">
      <div className="card-head">
        <h2 className="card-title" id="sources-title">참고한 사이트</h2>
        <span className="hint">앱에서만 보임 · 네이버에는 올라가지 않습니다</span>
      </div>

      {links && (
        <div className="stack-tight">
          {hasInfo ? (
            <p className="label">원고 끝 &lsquo;📍 방문 정보&rsquo;에 넣은 링크</p>
          ) : (
            <div className="row-between">
              <p className="label">이 원고에는 &lsquo;📍 방문 정보&rsquo;(주소·운영시간·지도 링크)가 없습니다</p>
              {job.draft && (
                <button type="button" className="button button-secondary" disabled={disabled} onClick={onAddInfo}>
                  원고 끝에 방문 정보 넣기
                </button>
              )}
            </div>
          )}
          <ul className="source-list">
            <li>
              <a href={links.map} target="_blank" rel="noopener noreferrer">🗺️ 네이버 지도</a>
              <span className="hint"> · {links.mapFromUser ? "입력한 링크" : "이름·지역으로 찾는 지도 검색 링크"}</span>
            </li>
            {links.booking ? (
              <li>
                <a href={links.booking} target="_blank" rel="noopener noreferrer">📅 네이버 예약</a>
                <span className="hint"> · 조사에서 찾은 주소입니다. 눌러서 맞는 곳인지 확인해 주세요.</span>
              </li>
            ) : (
              <li className="hint">네이버 예약 페이지는 찾지 못해 넣지 않았습니다.</li>
            )}
          </ul>
        </div>
      )}

      {sources.length === 0 ? (
        <p className="hint">조사한 출처가 없습니다. 원고의 사실 정보(주소·가격 등)는 메모와 사진에서만 나왔습니다.</p>
      ) : (
        <ol className="source-list numbered">
          {sources.map((u) => {
            const used = factsOf(u);
            return (
              <li key={u}>
                <a href={u} target="_blank" rel="noopener noreferrer" title={u}>
                  {host(u)}
                </a>
                {shortUrl(u) !== host(u) && <span className="hint"> {shortUrl(u)}</span>}
                {used.length > 0 && <div className="hint">이 사이트에서 가져온 정보: {used.join(", ")}</div>}
              </li>
            );
          })}
        </ol>
      )}
      {reviewUrls.length > 0 && (
        <div className="stack-tight">
          <p className="label">참고한 {job.input.kind === "product" ? "사용" : "방문"} 후기 {reviewUrls.length}편</p>
          <ol className="source-list numbered">
            {reviewUrls.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noopener noreferrer" title={u}>{host(u)}</a>
                {shortUrl(u) !== host(u) && <span className="hint"> {shortUrl(u)}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {research && (
        <p className="hint">{new Date(research.checkedAt).toLocaleString("ko-KR")} 기준 조사 · 사이트를 눌러 원문을 확인할 수 있습니다.</p>
      )}
    </section>
  );
}
