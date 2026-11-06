"use client";

import { KIND_TEXT, type MemoFieldText } from "../lib/jobs/reviewKinds";
import type { ReviewKind, VisitMemo } from "../lib/jobs/types";

interface Props {
  kind: ReviewKind;
  memo: VisitMemo;
  onChange: (m: VisitMemo) => void;
  disabled: boolean;
}

/**
 * 방문·사용 메모: 경험 평가는 여기 적은 내용만 글에 쓰인다(지어내지 않음). 칸 이름은 후기 종류에 따라 바뀐다.
 * 3열 배치: 한 줄 칸 + 별점 → 여러 줄 칸 → 자유 메모(전체 폭)
 */
export function MemoFields({ kind, memo, onChange, disabled }: Props) {
  const set = (name: keyof VisitMemo, value: string | number | undefined) => {
    const next = { ...memo, [name]: value };
    if (value === "" || value === undefined) delete next[name];
    onChange(next);
  };
  const fields = KIND_TEXT[kind].memo;

  const render = (f: MemoFieldText) => {
    const id = `memo-${f.key}`;
    const value = memo[f.key] ?? "";
    return (
      <div className={f.key === "free" ? "field span-all" : "field"} key={f.key}>
        <label className="label" htmlFor={id}>{f.label}</label>
        {f.multiline ? (
          <textarea id={id} className="input textarea" rows={2} maxLength={f.max} placeholder={f.placeholder} value={value} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />
        ) : (
          <input id={id} className="input" maxLength={f.max} placeholder={f.placeholder} value={value} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />
        )}
      </div>
    );
  };

  return (
    <div className="grid3even">
      {fields.filter((f) => !f.multiline).map(render)}
      <div className="field">
        <span className="label" id="memo-rating">별점</span>
        <div className="rating" role="radiogroup" aria-labelledby="memo-rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={memo.rating === n}
              aria-label={`${n}점`}
              disabled={disabled}
              className={memo.rating && n <= memo.rating ? "star on" : "star"}
              onClick={() => set("rating", memo.rating === n ? undefined : n)}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      {fields.filter((f) => f.multiline).map(render)}
    </div>
  );
}
