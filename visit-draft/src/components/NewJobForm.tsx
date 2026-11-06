"use client";

import exifr from "exifr";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText } from "../lib/client/api";
import { FACE_MODE_LABELS, LENGTH_LABELS } from "../lib/client/labels";
import { loadPrefs, savePrefs } from "../lib/client/prefs";
import type { AiProvider, FaceMode } from "../lib/config/schema";
import { KIND_TEXT } from "../lib/jobs/reviewKinds";
import { REVIEW_KINDS, type ReviewKind, type VisitMemo } from "../lib/jobs/types";
import { MemoFields } from "./MemoFields";
import { PhotoPicker, type PhotoLimits } from "./PhotoPicker";
import { Segmented } from "./Segmented";
import { PROVIDER_LABELS } from "./SettingsPanel";

type Length = keyof typeof LENGTH_LABELS;
const DEFAULT_DISCLOSURE = "이 글은 업체로부터 제품·서비스를 무상으로 제공받아 작성했습니다.";
const KIND_ICON: Record<ReviewKind, string> = { place: "📍", product: "🛍️" };
const TEMPLATE_MODES = [
  ["mine", "내 블로그 문체"],
  ["other", "다른 블로그 참고"],
] as const;

interface Props {
  limits: PhotoLimits;
  provider: AiProvider;
  defaultFaceMode: FaceMode;
  onStarted: (jobId: string, runId: string) => void;
  /** 오른쪽 아래에 놓을 최근 작업 목록 */
  recent: ReactNode;
}

/** 새 후기 입력. 왼쪽: 종류 → 대상 → 메모 → 사진, 오른쪽(고정): 블로그·템플릿 → 글 옵션 → 동의·시작 */
export function NewJobForm({ limits, defaultFaceMode, provider, onStarted, recent }: Props) {
  const [kind, setKind] = useState<ReviewKind>("place");
  const [blog, setBlog] = useState("");
  const [category, setCategory] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [template, setTemplate] = useState("");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [area, setArea] = useState("");
  const [memo, setMemo] = useState<VisitMemo>({});
  const [files, setFiles] = useState<File[]>([]);
  const [faceMode, setFaceMode] = useState<FaceMode>(defaultFaceMode);
  const [length, setLength] = useState<Length>("normal");
  const [hashtagCount, setHashtagCount] = useState(10);
  const [sponsored, setSponsored] = useState(false);
  const [disclosure, setDisclosure] = useState(DEFAULT_DISCLOSURE);
  const [sortByTime, setSortByTime] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const k = KIND_TEXT[kind];

  // 마지막에 쓴 블로그·옵션을 불러온다(이 브라우저에만 저장)
  useEffect(() => {
    const p = loadPrefs();
    if (p.kind && (REVIEW_KINDS as readonly string[]).includes(p.kind)) setKind(p.kind as ReviewKind);
    if (p.blog) setBlog(p.blog);
    if (p.category) setCategory(p.category);
    if (p.template) setTemplate(p.template);
    if (typeof p.useTemplate === "boolean") setUseTemplate(p.useTemplate);
    if (p.faceMode && p.faceMode in FACE_MODE_LABELS) setFaceMode(p.faceMode as FaceMode);
    if (p.length && p.length in LENGTH_LABELS) setLength(p.length as Length);
    if (typeof p.hashtagCount === "number") setHashtagCount(p.hashtagCount);
    if (typeof p.sortByTime === "boolean") setSortByTime(p.sortByTime);
  }, []);

  // 장소 후기에서 방문일이 비어 있으면 첫 사진의 촬영일로 채운다
  useEffect(() => {
    if (kind !== "place" || memo.visitedOn || files.length === 0) return;
    let cancelled = false;
    exifr
      .parse(files[0]!, ["DateTimeOriginal"])
      .then((d: { DateTimeOriginal?: Date } | undefined) => {
        const t = d?.DateTimeOriginal;
        if (!cancelled && t instanceof Date && !Number.isNaN(t.getTime())) {
          const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
          setMemo((m) => (m.visitedOn ? m : { ...m, visitedOn: day }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [files, memo.visitedOn, kind]);

  const chooseKind = (next: ReviewKind) => {
    if (next === kind) return;
    setKind(next);
    // 칸의 뜻이 바뀌므로(방문일 ↔ 사용 기간 등) 메모는 비운다
    setMemo({});
  };

  const categoryValid = /^\d{0,10}$/.test(category.trim());
  const templateOk = !useTemplate || template.trim().length > 0;
  const missing = [!blog.trim() && "블로그", !name.trim() && k.subject.name, files.length === 0 && "사진", !templateOk && "참고 블로그 주소", !consent && "전송 동의"].filter(Boolean);
  const ready = missing.length === 0 && categoryValid && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    savePrefs({ kind, blog: blog.trim(), category: category.trim(), template: template.trim(), useTemplate, faceMode, length, hashtagCount, sortByTime });
    const payload = {
      kind,
      blog: blog.trim(),
      ...(category.trim() ? { category: category.trim() } : {}),
      ...(useTemplate && template.trim() ? { template: template.trim() } : {}),
      place: { name: name.trim(), ...(link.trim() ? { link: link.trim() } : {}), ...(area.trim() ? { area: area.trim() } : {}) },
      memo,
      options: { faceMode, length, hashtagCount, sortByTime, ...(sponsored && disclosure.trim() ? { disclosure: disclosure.trim() } : {}) },
      consent: true,
    };
    const form = new FormData();
    form.set("payload", JSON.stringify(payload));
    files.forEach((f) => form.append("images", f, f.name));
    try {
      const res = await api.form<{ jobId: string; runId: string }>("/api/jobs", form);
      onStarted(res.jobId, res.runId);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="stack">
      <div className="page-head">
        <div>
          <h1 className="display">새 후기 만들기</h1>
          <p className="lead">사진과 메모를 주면 AI가 사진을 분석하고 정보를 조사해 블로그 원고를 쓰고, 네이버에 임시저장합니다. 발행은 직접 하세요.</p>
        </div>
        <div className="kind-tiles" role="radiogroup" aria-label="후기 종류">
              {REVIEW_KINDS.map((kk) => (
                <button key={kk} type="button" role="radio" aria-checked={kind === kk} className="kind-tile" disabled={busy} onClick={() => chooseKind(kk)}>
                  <span className="kind-icon" aria-hidden="true">{KIND_ICON[kk]}</span>
                  <span className="kind-text">
                    <strong>{KIND_TEXT[kk].label}</strong>
                    <span className="hint">{KIND_TEXT[kk].description}</span>
                  </span>
                </button>
              ))}
        </div>
      </div>

      <div className="layout">
        <div className="col">
          <section className="card" aria-labelledby="s-subject">
            <h2 className="card-title" id="s-subject"><span className="step-no">1</span>{k.subject.title}</h2>
            <div className="grid3">
              <div className="field">
                <label className="label" htmlFor="subject-name">{k.subject.name}</label>
                <input id="subject-name" className="input" placeholder={k.subject.namePlaceholder} value={name} maxLength={100} disabled={busy} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="subject-area">{k.subject.area} <span className="hint">(선택)</span></label>
                <input id="subject-area" className="input" placeholder={k.subject.areaPlaceholder} value={area} maxLength={100} disabled={busy} onChange={(e) => setArea(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="subject-link">{k.subject.link} <span className="hint">(선택)</span></label>
                <input id="subject-link" className="input" type="url" placeholder={k.subject.linkPlaceholder} value={link} maxLength={500} disabled={busy} onChange={(e) => setLink(e.target.value)} />
              </div>
            </div>
            <p className="hint">{k.researchHint}</p>
          </section>

          <section className="card" aria-labelledby="s-memo">
            <div className="card-head">
              <h2 className="card-title" id="s-memo"><span className="step-no">2</span>{k.memoTitle} <span className="hint">(모두 선택)</span></h2>
            </div>
            <p className="hint">{k.memoHint} 비워 두면 AI가 사진 분석 결과 위주로 씁니다.</p>
            <MemoFields kind={kind} memo={memo} onChange={setMemo} disabled={busy} />
          </section>

          <section className="card" aria-labelledby="s-photo">
            <h2 className="card-title" id="s-photo"><span className="step-no">3</span>사진</h2>
            <PhotoPicker limits={limits} files={files} onChange={setFiles} disabled={busy} />
            <div className="grid2">
              <div className="field">
                <span className="label">사진 속 얼굴 가리기</span>
                <Segmented label="사진 속 얼굴 가리기" value={faceMode} disabled={busy} onChange={setFaceMode} options={Object.entries(FACE_MODE_LABELS) as [FaceMode, string][]} />
              </div>
              <label className="check check-end">
                <input type="checkbox" checked={sortByTime} disabled={busy} onChange={(e) => setSortByTime(e.target.checked)} />
                촬영 시간 순서로 정리
              </label>
            </div>
          </section>
        </div>

        <div className="col sticky">
          <section className="card" aria-labelledby="s-blog">
            <h2 className="card-title" id="s-blog"><span className="step-no">4</span>블로그·글 템플릿</h2>
            <div className="grid2">
              <div className="field">
                <label className="label" htmlFor="blog">내 블로그</label>
                <input id="blog" className="input" placeholder="주소 또는 아이디" value={blog} maxLength={2048} disabled={busy} autoComplete="off" onChange={(e) => setBlog(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="category">카테고리 번호</label>
                <input id="category" className="input" inputMode="numeric" placeholder="선택" value={category} maxLength={10} aria-invalid={!categoryValid} disabled={busy} onChange={(e) => setCategory(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <span className="label">글 구성·말투</span>
              <Segmented label="글 구성·말투" value={useTemplate ? "other" : "mine"} disabled={busy} onChange={(v) => setUseTemplate(v === "other")} options={TEMPLATE_MODES} />
            </div>
            {useTemplate ? (
              <div className="field">
                <label className="label" htmlFor="template">참고할 블로그 주소</label>
                <input id="template" className="input" placeholder="blog.naver.com/아이디 또는 글 주소" value={template} maxLength={2048} disabled={busy} autoComplete="off" onChange={(e) => setTemplate(e.target.value)} />
                <p className="hint">네이버 블로그만 됩니다. 글 주소를 넣으면 그 글 한 편을, 블로그 주소면 최근 글을 참고합니다. 구성과 말투만 따르고 문장은 새로 씁니다.</p>
              </div>
            ) : (
              <p className="hint">내 블로그의 최근 글 문체를 따라 씁니다. 카테고리 링크(…categoryNo=숫자)를 붙여 넣으면 카테고리도 잡힙니다.</p>
            )}
          </section>

          <section className="card" aria-labelledby="s-opt">
            <h2 className="card-title" id="s-opt"><span className="step-no">5</span>글 옵션</h2>
            <div className="field">
              <span className="label">글 길이</span>
              <Segmented label="글 길이" value={length} disabled={busy} onChange={setLength} options={Object.entries(LENGTH_LABELS) as [Length, string][]} />
            </div>
            <div className="inline-row">
              <label className="label" htmlFor="tags">해시태그 개수</label>
              <input id="tags" className="input input-narrow" type="number" min={0} max={30} value={hashtagCount} disabled={busy} onChange={(e) => setHashtagCount(Math.max(0, Math.min(30, Number(e.target.value) || 0)))} />
            </div>
            <label className="check">
              <input type="checkbox" checked={sponsored} disabled={busy} onChange={(e) => setSponsored(e.target.checked)} />
              협찬·제공받은 글입니다(글 맨 위에 표기)
            </label>
            {sponsored && (
              <div className="field">
                <input className="input" aria-label="협찬 표기 문구" value={disclosure} maxLength={200} disabled={busy} onChange={(e) => setDisclosure(e.target.value)} />
                <p className="hint">문구가 공정위 추천·보증 심사지침에 맞는지 확인해 주세요.</p>
              </div>
            )}
            {kind === "product" && !sponsored && <p className="hint">체험단·제품 제공을 받았다면 협찬 표기를 꼭 켜 주세요.</p>}
          </section>

          <section className="card">
            <label className="check">
              <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                얼굴을 가린 사진 사본, {k.short} 정보, 메모가 <strong>{PROVIDER_LABELS[provider]} API</strong>로 전송되는 것에 동의합니다. 원본 사진·위치 정보는 보내지 않습니다.
                {provider === "google" && " 무료 등급 키라면 Google이 내용을 서비스 개선에 쓰고 사람이 검토할 수 있으니 메모에 개인정보를 적지 마세요."}
              </span>
            </label>
            {error && <p className="notice notice-danger" role="alert">{error}</p>}
            <button type="submit" className="button button-primary button-lg button-block" disabled={!ready}>
              {busy ? "시작하는 중…" : "후기 원고 만들기"}
            </button>
            {!ready && !busy && missing.length > 0 && <p className="hint">필요: {missing.join(", ")}</p>}
          </section>

          {recent}
        </div>
      </div>
    </form>
  );
}
