import { isValidRunId } from "../../../../../lib/runs/runManager";
import type { RunEvent } from "../../../../../lib/runs/types";
import { jsonError, rejectNonLocal, serverContext } from "../../../../../lib/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_INTERVAL_MS = 15000;

/** 진행 상황 스트림(SSE). 연결하면 지금까지의 이벤트를 처음부터 다시 보낸다. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const { runs } = serverContext();
  if (!isValidRunId(id) || !runs.get(id)) return jsonError(404, "실행 기록이 없습니다.");

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let ping: ReturnType<typeof setInterval> | undefined;

      cleanup = () => {
        if (closed) return;
        closed = true;
        if (ping) clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 이미 닫힌 스트림
        }
      };
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (e: RunEvent) => {
        write(`data: ${JSON.stringify(e)}\n\n`);
        if (e.type === "done" || e.type === "error") cleanup();
      };

      // 로그인 대기·AI 응답 대기처럼 이벤트가 한동안 없을 때 연결이 끊기지 않도록 주석 줄을 보낸다
      ping = setInterval(() => write(": ping\n\n"), PING_INTERVAL_MS);
      unsubscribe = runs.subscribe(id, send);
      if (closed) unsubscribe();
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" },
  });
}
