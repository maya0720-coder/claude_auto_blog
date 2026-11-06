"use client";

/**
 * 이 브라우저에만 남기는 편의 설정(마지막에 쓴 블로그·옵션). 개인정보(메모·장소)는 남기지 않는다.
 * 저장소를 쓸 수 없는 환경에서도 화면이 동작하도록 실패는 무시한다.
 */
const KEY = "visit-draft.prefs.v1";

export interface Prefs {
  blog?: string;
  category?: string;
  faceMode?: string;
  length?: string;
  hashtagCount?: number;
  sortByTime?: boolean;
  kind?: string;
  /** 참고 블로그 주소(공개 블로그 주소라 개인정보가 아님) */
  template?: string;
  useTemplate?: boolean;
}

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(p: Prefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 저장하지 못해도 기능에는 지장 없음
  }
}
