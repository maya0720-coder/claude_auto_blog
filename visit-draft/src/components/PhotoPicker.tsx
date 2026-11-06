"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

export interface PhotoLimits {
  maxCount: number;
  maxBytes: number;
  extensions: string[];
}

interface Props {
  limits: PhotoLimits;
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}

const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

/** 사진 선택: 끌어다 놓기/눌러서 고르기, 미리보기, 순서 바꾸기, 빼기. 서버에서도 다시 검사한다. */
export function PhotoPicker({ limits, files, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string>();
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const full = files.length >= limits.maxCount;
  const maxMb = Math.round(limits.maxBytes / 1048576);

  const add = (incoming: File[]) => {
    setError(undefined);
    const accepted: File[] = [];
    for (const f of incoming) {
      if (!limits.extensions.includes(extOf(f.name))) {
        setError(`${f.name}: 지원하지 않는 형식입니다. (${limits.extensions.join(", ")}) — 아이폰 HEIC는 '호환성 우선'으로 내보내 주세요.`);
        continue;
      }
      if (f.size === 0 || f.size > limits.maxBytes) {
        setError(`${f.name}: 파일이 비어 있거나 ${maxMb}MB를 넘습니다.`);
        continue;
      }
      accepted.push(f);
    }
    const room = limits.maxCount - files.length;
    if (accepted.length > room) setError(`사진은 최대 ${limits.maxCount}장까지 넣을 수 있습니다.`);
    if (accepted.length > 0 && room > 0) onChange([...files, ...accepted.slice(0, room)]);
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= files.length) return;
    const next = [...files];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  const openPicker = () => {
    if (!disabled && !full) inputRef.current?.click();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setActive(false);
    if (!disabled) add([...e.dataTransfer.files]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  };

  return (
    <div className="field">
      <div
        className="dropzone"
        role="button"
        tabIndex={disabled || full ? -1 : 0}
        aria-disabled={disabled || full}
        data-active={active}
        onClick={openPicker}
        onKeyDown={onKey}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !full) setActive(true);
        }}
        onDragLeave={() => setActive(false)}
        onDrop={onDrop}
      >
        <strong>{full ? "사진을 모두 넣었습니다" : "사진을 끌어다 놓거나 눌러서 고르세요"}</strong>
        <p className="hint">
          최대 {limits.maxCount}장 · {limits.extensions.join(" ").replaceAll(".", "").toUpperCase()} · 장당 {maxMb}MB 이하
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={limits.extensions.join(",")}
        multiple
        hidden
        onChange={(e) => {
          add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {urls.length > 0 && (
        <div className="thumbs">
          {urls.map((u, i) => (
            <div className="thumb" key={u}>
              <img src={u} alt={`선택한 사진 ${i + 1}`} />
              <span className="thumb-index">{i + 1}</span>
              <button
                type="button"
                className="thumb-remove"
                aria-label={`사진 ${i + 1} 빼기`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                ×
              </button>
              <div className="thumb-move">
                <button type="button" aria-label={`사진 ${i + 1} 앞으로`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                  ◀
                </button>
                <button
                  type="button"
                  aria-label={`사진 ${i + 1} 뒤로`}
                  disabled={disabled || i === files.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ▶
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="hint">
        {limits.maxCount}장 중 {files.length}장 · 얼굴은 자동으로 가리고, 위치 정보(GPS 등)는 지운 사본만 씁니다.
      </p>
    </div>
  );
}
