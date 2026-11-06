import { readFile } from "node:fs/promises";
import path from "node:path";
import { isValidJobId } from "../../../../../lib/jobs/store";
import { jsonError, rejectNonLocal, serverContext } from "../../../../../lib/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 임시저장 직후 화면. 파일 이름은 서버가 저장한 값만 쓰고, 작업 폴더 밖은 읽지 않는다. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const { id } = await params;
  const ctx = serverContext();
  const job = isValidJobId(id) ? ctx.jobs.read(id) : undefined;
  const name = job?.saved?.screenshot;
  if (!job || !name || name !== path.basename(name) || !name.endsWith(".png")) return jsonError(404, "스크린샷이 없습니다.");
  try {
    const data = await readFile(path.join(ctx.jobs.dir(id), "screens", name));
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return jsonError(404, "스크린샷이 없습니다.");
  }
}
