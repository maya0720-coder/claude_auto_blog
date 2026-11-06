/**
 * AI 공급자·API 키 설정. 키는 프로젝트 폴더의 .env.local(.gitignore 대상)에만 저장하고,
 * 화면·로그에는 앞부분만 보여 준다(설계서 11.1). 실행 중인 서버에도 바로 반영한다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifyAnthropicKey } from "../ai/anthropic";
import { verifyGoogleKey } from "../ai/google";
import { aiModel, aiProvider, PROVIDER_KEY_ENV } from "../ai/provider";
import { PROJECT_ROOT } from "../config/load";
import { AI_PROVIDERS, type AiProvider, type Defaults } from "../config/schema";

const ENV_FILE = path.join(/*turbopackIgnore: true*/ PROJECT_ROOT, ".env.local");
const PROVIDER_ENV = "AI_PROVIDER";

/**
 * 키 모양 검사. Google 키는 발급 방식에 따라 앞부분·길이가 다를 수 있어 접두어를 강제하지 않고,
 * 허용 문자·길이만 본 뒤 실제 확인(모델 정보 조회)에 맡긴다.
 */
const KEY_PATTERNS: Record<AiProvider, { re: RegExp; hint: string }> = {
  google: { re: /^[A-Za-z0-9._-]{20,300}$/, hint: "Google AI Studio에서 받은 API 키" },
  anthropic: { re: /^sk-ant-[A-Za-z0-9_-]{20,300}$/, hint: "sk-ant-로 시작하는 Anthropic API 키" },
};

/**
 * 붙여 넣을 때 흔히 섞이는 것을 걷어 낸다: 공백·줄바꿈, 앞뒤 따옴표, "GEMINI_API_KEY=" 같은 변수 이름.
 * 키 자체에는 공백이 없으므로 모든 공백을 지워도 안전하다.
 */
export function normalizeKey(raw: string): string {
  let k = raw.replace(/\s+/g, "");
  k = k.replace(/^[A-Z_]+=/, "");
  k = k.replace(/^["'`]+|["'`]+$/g, "");
  return k;
}

export class ApiKeyError extends Error {
  override name = "ApiKeyError";
}

export function maskKey(key: string): string {
  return `${key.slice(0, 6)}${"*".repeat(8)}`;
}

export interface KeyStatus {
  configured: boolean;
  masked?: string;
}

export interface AiSettingsStatus {
  provider: AiProvider;
  model: string;
  keys: Record<AiProvider, KeyStatus>;
}

export function aiSettingsStatus(cfg: Defaults["ai"]): AiSettingsStatus {
  const keyStatus = (p: AiProvider): KeyStatus => {
    const key = process.env[PROVIDER_KEY_ENV[p]]?.trim();
    return key ? { configured: true, masked: maskKey(key) } : { configured: false };
  };
  return { provider: aiProvider(cfg), model: aiModel(cfg), keys: { google: keyStatus("google"), anthropic: keyStatus("anthropic") } };
}

/** .env.local의 다른 줄은 그대로 두고 지정한 줄만 바꾼다. */
export function upsertEnvLine(content: string, name: string, value: string): string {
  const lines = content.split(/\r?\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
  const kept = lines.filter((l) => !l.trimStart().startsWith(`${name}=`));
  return [...kept, `${name}=${value}`].join("\n") + "\n";
}

function writeEnv(updates: Record<string, string>): void {
  let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  for (const [k, v] of Object.entries(updates)) content = upsertEnvLine(content, k, v);
  writeFileSync(ENV_FILE, content, { encoding: "utf8", mode: 0o600 });
  for (const [k, v] of Object.entries(updates)) process.env[k] = v;
}

/**
 * 공급자를 고르고(필요하면 키도) 저장한다. 키를 주면 형식 검사 후 모델 정보 조회(토큰 비용 없음)로 확인한다.
 * 키 없이 공급자만 바꿀 때는 그 공급자의 키가 이미 있어야 한다.
 */
export async function saveAiSettings(
  provider: string,
  rawKey: string | undefined,
  cfg: Defaults["ai"],
): Promise<{ verified: boolean | undefined }> {
  if (!AI_PROVIDERS.includes(provider as AiProvider)) throw new ApiKeyError("알 수 없는 AI 공급자입니다.");
  const p = provider as AiProvider;
  const key = rawKey === undefined ? undefined : normalizeKey(rawKey);

  if (!key) {
    if (!process.env[PROVIDER_KEY_ENV[p]]?.trim()) throw new ApiKeyError("이 공급자의 API 키를 함께 입력해 주세요.");
    writeEnv({ [PROVIDER_ENV]: p });
    return { verified: undefined };
  }

  const pattern = KEY_PATTERNS[p];
  if (!pattern.re.test(key)) {
    // 원인을 찾을 수 있게 길이와 문자 종류만 알려 준다(키 값은 보여 주지 않음)
    const odd = key.match(/[^A-Za-z0-9._-]/) ? " 키에 쓰지 않는 문자(한글·특수문자 등)가 섞여 있습니다." : "";
    throw new ApiKeyError(`API 키 형식이 올바르지 않습니다(${key.length}자).${odd} ${pattern.hint}를 그대로 복사해 붙여 넣어 주세요.`);
  }
  const model = aiModel(cfg, p);
  const result = p === "google" ? await verifyGoogleKey(key, model) : await verifyAnthropicKey(key, model);
  if (result === "rejected") throw new ApiKeyError(`이 키로 모델(${model})을 쓸 수 없습니다. 키가 맞는지, 해당 API가 켜져 있는지 확인해 주세요.`);
  writeEnv({ [PROVIDER_KEY_ENV[p]]: key, [PROVIDER_ENV]: p });
  return { verified: result === "ok" };
}
