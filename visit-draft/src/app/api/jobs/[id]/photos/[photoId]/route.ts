import { readFile } from "node:fs/promises";
import { isValidJobId } from "../../../../../../lib/jobs/store";
import { jsonError, rejectNonLocal, serverContext } from "../../../../../../lib/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 업로드용 사본(얼굴 가림·EXIF 없음)을 보여 준다. 원본은 화면에 내보내지 않는다. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const { id, photoId } = await params;
  const ctx = serverContext();
  const job = isValidJobId(id) ? ctx.jobs.read(id) : undefined;
  const photo = job?.photos.find((p) => p.id === photoId);
  if (!job || !photo) return jsonError(404, "사진을 찾을 수 없습니다.");
  try {
    const data = await readFile(ctx.jobs.photoPath(id, photo, "upload"));
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return jsonError(404, "사진이 아직 준비되지 않았습니다.");
  }
}
