"use client";

import { useState } from "react";

type Status = "idle" | "stopping" | "stopped" | "error";

/** 상단 바의 [앱 종료] 버튼. 백그라운드로 실행 중인 앱 서버를 끈다. */
export function AppMenu({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>();

  const stop = async () => {
    if (!window.confirm("앱을 종료할까요? 다시 쓰려면 바탕화면의 '방문기록' 아이콘을 실행하면 됩니다.")) return;
    setStatus("stopping");
    try {
      const res = await fetch("/api/app/shutdown", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error ?? "종료하지 못했습니다.");
        setStatus("error");
        return;
      }
      setStatus("stopped");
    } catch {
      setStatus("stopped"); // 이미 꺼져 있음
    }
  };

  if (status === "stopped") {
    return (
      <div className="app-stopped" role="status">
        <h2 className="card-title">앱을 종료했습니다</h2>
        <p className="hint">이 탭은 닫아도 됩니다. 다시 쓰려면 바탕화면의 &lsquo;방문기록&rsquo; 아이콘을 실행하세요.</p>
      </div>
    );
  }

  return (
    <span className="actions">
      {status === "error" && message && <span className="error-text">{message}</span>}
      <button
        type="button"
        className="button button-ghost button-small"
        onClick={() => void stop()}
        disabled={disabled || status === "stopping"}
        title={disabled ? "실행 중인 작업이 끝난 뒤 종료할 수 있습니다" : undefined}
      >
        {status === "stopping" ? "종료 중…" : "앱 종료"}
      </button>
    </span>
  );
}
