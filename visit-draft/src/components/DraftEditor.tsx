"use client";

import { useEffect, useState } from "react";
import { api, errorText } from "../lib/client/api";
import type { DraftBlock, Job, PostDraft } from "../lib/jobs/types";

interface Props {
  job: Job;
  /** 사진 주소 캐시를 무효화하는 값(가리기 방식을 바꾸면 달라짐) */
  photoVersion: string;
  onSaved: (job: Job) => void;
  onDirtyChange: (dirty: boolean) => void;
}

const parseTags = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 30);

/** 원고 미리보기·편집(설계서 A2): 블록 단위 수정, 순서 바꾸기, 삭제, 문단 추가 */
export function DraftEditor({ job, photoVersion, onSaved, onDirtyChange }: Props) {
  const [draft, setDraft] = useState<PostDraft>(job.draft!);
  const [tags, setTags] = useState(job.draft!.hashtags.map((t) => `#${t}`).join(" "));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();

  useEffect(() => {
    setDraft(job.draft!);
    setTags(job.draft!.hashtags.map((t) => `#${t}`).join(" "));
    setDirty(false);
  }, [job.draft]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const change = (next: PostDraft) => {
    setDraft(next);
    setDirty(true);
    setMessage(undefined);
  };
  const setBlock = (i: number, b: DraftBlock) => change({ ...draft, blocks: draft.blocks.map((x, j) => (j === i ? b : x)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.blocks.length) return;
    const blocks = [...draft.blocks];
    [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
    change({ ...draft, blocks });
  };
  const remove = (i: number) => {
    const b = draft.blocks[i];
    if (b?.type === "photo" && !window.confirm("이 사진을 글에서 뺄까요?")) return;
    change({ ...draft, blocks: draft.blocks.filter((_, j) => j !== i) });
  };
  const addTextAfter = (i: number) =>
    change({ ...draft, blocks: [...draft.blocks.slice(0, i + 1), { type: "text", text: "새 문단" }, ...draft.blocks.slice(i + 1)] });

  const save = async () => {
    setBusy(true);
    const next: PostDraft = { ...draft, hashtags: parseTags(tags), blocks: draft.blocks.filter((b) => b.type === "photo" || b.text.trim()) };
    try {
      const res = await api.put<{ job: Job }>(`/api/jobs/${job.id}`, { draft: next });
      setDirty(false);
      setMessage({ kind: "ok", text: "고친 내용을 저장했습니다." });
      onSaved(res.job);
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="draft-title">
      <div className="card-head">
        <h2 className="card-title" id="draft-title">원고 확인·수정</h2>
        <span className="hint">
          본문 {draft.blocks.reduce((n, b) => n + (b.type === "photo" ? 0 : b.text.length), 0).toLocaleString("ko-KR")}자 · 사진 {draft.blocks.filter((b) => b.type === "photo").length}장
        </span>
      </div>
      <div className="field">
        <label className="label" htmlFor="title">제목</label>
        <input id="title" className="input editor-title" maxLength={100} value={draft.title} onChange={(e) => change({ ...draft, title: e.target.value })} />
        {draft.titleCandidates.length > 0 && (
          <div className="chips" aria-label="다른 제목 후보">
            {draft.titleCandidates.map((t) => (
              <button key={t} type="button" className="chip" onClick={() => change({ ...draft, title: t })}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <ol className="blocks">
        {draft.blocks.map((b, i) => (
          <li key={i} className={`block block-kind-${b.type}`}>
            {b.type === "photo" ? (
              <div className="block-photo">
                <img src={`/api/jobs/${job.id}/photos/${b.photoId}?v=${encodeURIComponent(photoVersion)}`} alt={b.caption || `사진 ${b.photoId}`} loading="lazy" />
                <input className="input" aria-label="사진 설명" maxLength={300} value={b.caption} placeholder="사진 설명" onChange={(e) => setBlock(i, { ...b, caption: e.target.value })} />
              </div>
            ) : b.type === "heading" ? (
              <input className="input input-heading" aria-label="소제목" maxLength={200} value={b.text} onChange={(e) => setBlock(i, { ...b, text: e.target.value })} />
            ) : (
              <textarea className="input textarea" aria-label="본문 문단" maxLength={3000} rows={Math.min(14, Math.max(2, Math.ceil(b.text.length / 70)))} value={b.text} onChange={(e) => setBlock(i, { ...b, text: e.target.value })} />
            )}
            <div className="block-tools">
              <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" aria-label="아래로" disabled={i === draft.blocks.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" aria-label="아래에 문단 추가" onClick={() => addTextAfter(i)}>＋</button>
              <button type="button" aria-label="삭제" onClick={() => remove(i)}>✕</button>
            </div>
          </li>
        ))}
      </ol>

      <div className="field">
        <label className="label" htmlFor="tags-edit">해시태그</label>
        <input id="tags-edit" className="input" value={tags} onChange={(e) => { setTags(e.target.value); setDirty(true); }} />
      </div>
      {message && <p className={`notice ${message.kind === "ok" ? "notice-info" : "notice-danger"}`} role="status">{message.text}</p>}
      <div className="actions save-bar">
        <button type="button" className="button button-primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "저장 중…" : "고친 내용 저장"}
        </button>
        <span className="hint">{dirty ? "저장하지 않은 수정이 있습니다." : "블록에 마우스를 올리면 순서 바꾸기·추가·삭제 도구가 보입니다."}</span>
      </div>
    </section>
  );
}
