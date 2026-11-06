"use client";

import { useEffect, useReducer } from "react";
import type { RunEvent } from "../runs/types";
import { APP_DOWN_MESSAGE } from "./api";
import { initialRunState, runReducer } from "./runState";

async function serverAlive(): Promise<boolean> {
  try {
    return (await fetch("/api/runs/active", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}

/** 실행 ID의 진행 상황 스트림(SSE)에 연결한다. 서버는 다시 연결하면 처음부터 보내므로 그때 상태를 비운다. */
export function useRunStream(runId: string, steps: readonly string[]) {
  const [state, dispatch] = useReducer(runReducer, steps, initialRunState);

  useEffect(() => {
    let closed = false;
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    const close = () => {
      closed = true;
      source.close();
    };
    source.onopen = () => dispatch({ type: "reset", steps });
    source.onmessage = (msg: MessageEvent<string>) => {
      let event: RunEvent;
      try {
        event = JSON.parse(msg.data) as RunEvent;
      } catch {
        return;
      }
      dispatch({ type: "event", event });
      if (event.type === "done" || event.type === "error") close();
    };
    source.onerror = () => {
      if (closed) return;
      if (source.readyState === EventSource.CLOSED) {
        close();
        dispatch({ type: "failed", message: "진행 상황 연결이 끊겼습니다. 화면을 새로 고쳐 주세요." });
        return;
      }
      void serverAlive().then((alive) => {
        if (!alive && !closed) {
          close();
          dispatch({ type: "failed", message: APP_DOWN_MESSAGE });
        }
      });
    };
    return close;
    // steps는 실행 종류마다 고정된 목록이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return state;
}
