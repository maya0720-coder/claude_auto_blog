"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, errorText } from "../lib/client/api";
import type { AiProvider } from "../lib/config/schema";
import { Segmented } from "./Segmented";

interface KeyStatus {
  configured: boolean;
  masked?: string;
}

export interface Settings {
  ai: { provider: AiProvider; model: string; keys: Record<AiProvider, KeyStatus> };
  saveRemaining: number;
  saveLimit: number;
}

export const PROVIDER_LABELS: Record<AiProvider, string> = { google: "Google Gemini", anthropic: "Anthropic Claude" };
const KEY_HINT: Record<AiProvider, { placeholder: string; where: string }> = {
  google: { placeholder: "Google AI Studio에서 받은 API 키", where: "aistudio.google.com의 'Get API key'" },
  anthropic: { placeholder: "sk-ant-로 시작하는 키", where: "console.anthropic.com" },
};

/** 설정(오른쪽 서랍): 글을 쓸 AI(Google Gemini / Anthropic Claude)와 API 키, 오늘 남은 임시저장 횟수 */
export function SettingsPanel({ onClose, onChanged }: { onClose: () => void; onChanged: (s: Settings) => void }) {
  const [settings, setSettings] = useState<Settings>();
  const [provider, setProvider] = useState<AiProvider>("google");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();

  // Esc로 닫는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    api
      .get<Settings>("/api/settings")
      .then((s) => {
        setSettings(s);
        setProvider(s.ai.provider);
      })
      .catch((e: unknown) => setMessage({ kind: "error", text: errorText(e) }));
  }, []);

  const current = settings?.ai.keys[provider];
  const canSave = key.trim().length >= 20 || (!!current?.configured && provider !== settings?.ai.provider);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const r = await api.post<{ ai: Settings["ai"]; verified?: boolean }>("/api/settings", {
        provider,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      });
      const next = { ...settings!, ai: r.ai };
      setSettings(next);
      onChanged(next);
      setKey("");
      setMessage({
        kind: "ok",
        text:
          r.verified === false
            ? "저장했습니다. 인터넷 문제로 키 확인은 하지 못했습니다."
            : `저장했습니다. 이제 ${PROVIDER_LABELS[provider]}(${r.ai.model})로 글을 씁니다.`,
      });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
    <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="card-head">
        <h2 className="card-title" id="settings-title">설정</h2>
        <button type="button" className="button button-ghost button-small" onClick={onClose} autoFocus>닫기</button>
      </div>
      <form className="stack-tight" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <span className="label">글을 쓸 AI</span>
          <Segmented label="글을 쓸 AI" value={provider} onChange={(p) => { setProvider(p); setMessage(undefined); }} options={Object.entries(PROVIDER_LABELS) as [AiProvider, string][]} />
        </div>
        <div className="field">
          <label className="label" htmlFor="api-key">{PROVIDER_LABELS[provider]} API 키</label>
          <p className="hint">
            현재: {settings ? (current?.configured ? `설정됨 (${current.masked})` : "설정 안 됨") : "확인 중…"} · 발급: {KEY_HINT[provider].where} · 키는 이 PC의
            visit-draft\.env.local 파일에만 저장됩니다.
          </p>
          <div className="actions">
            <input id="api-key" className="input input-grow" type="password" autoComplete="off" placeholder={current?.configured ? "바꿀 때만 입력" : KEY_HINT[provider].placeholder} value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="submit" className="button button-primary" disabled={busy || !canSave}>
              {busy ? "확인 중…" : "저장"}
            </button>
          </div>
        </div>
        {provider === "google" && (
          <p className="notice notice-warning">
            결제(빌링)가 연결되지 않은 <strong>무료 등급</strong> Google 키는, Google이 보낸 내용을 서비스 개선에 쓰고 사람이 검토할 수 있습니다.
            얼굴은 가려서 보내지만 방문 메모·장소 정보는 그대로 가니, 개인정보는 메모에 적지 말아 주세요. 결제가 연결된 프로젝트의 키를 권장합니다.
          </p>
        )}
      </form>
      {settings && (
        <p className="hint">
          사용 중: {PROVIDER_LABELS[settings.ai.provider]} ({settings.ai.model}) · 오늘 남은 임시저장: {settings.saveRemaining}/{settings.saveLimit}회
        </p>
      )}
      {message && <p className={`notice ${message.kind === "ok" ? "notice-success" : "notice-danger"}`} role="status">{message.text}</p>}
    </aside>
    </>
  );
}
