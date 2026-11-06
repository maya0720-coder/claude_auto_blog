import { SaveLimit } from "../../../lib/jobs/saveLimit";
import { jsonError, jsonOk, rejectNonLocal, serverContext } from "../../../lib/server/context";
import { readJson } from "../../../lib/server/runs";
import { aiSettingsStatus, ApiKeyError, saveAiSettings } from "../../../lib/settings/apiKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 설정 상태: AI 공급자·모델, 공급자별 키(가린 값), 오늘 남은 임시저장 횟수 */
export async function GET(req: Request): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  const { cfg } = serverContext();
  return jsonOk({
    ai: aiSettingsStatus(cfg.ai),
    saveRemaining: new SaveLimit(cfg.save).remaining(),
    saveLimit: cfg.save.dailyLimit,
  });
}

/** 공급자·API 키 저장. body: { provider, apiKey? } — 응답·로그에 키 값을 넣지 않는다. */
export async function POST(req: Request): Promise<Response> {
  const denied = rejectNonLocal(req);
  if (denied) return denied;
  let body: { provider?: unknown; apiKey?: unknown };
  try {
    body = (await readJson(req, 2000)) as typeof body;
  } catch {
    return jsonError(400, "요청 형식이 올바르지 않습니다.");
  }
  if (typeof body?.provider !== "string") return jsonError(400, "AI 공급자를 골라 주세요.");
  if (body.apiKey !== undefined && typeof body.apiKey !== "string") return jsonError(400, "API 키 형식이 올바르지 않습니다.");
  const { cfg } = serverContext();
  try {
    const { verified } = await saveAiSettings(body.provider, body.apiKey as string | undefined, cfg.ai);
    return jsonOk({ ai: aiSettingsStatus(cfg.ai), verified });
  } catch (err) {
    if (err instanceof ApiKeyError) return jsonError(400, err.message);
    console.error(`[api/settings] 설정 저장 실패: ${(err as Error).name}`);
    return jsonError(500, "설정을 저장하지 못했습니다.");
  }
}
