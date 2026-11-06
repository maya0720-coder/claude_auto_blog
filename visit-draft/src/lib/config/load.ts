import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { defaultsSchema, selectorsSchema, type Defaults, type Selectors } from "./schema";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * 프로젝트 루트(visit-draft/). 설정·데이터 경로는 모두 이 기준으로 해석한다.
 * Next.js 서버는 코드를 번들하므로 파일 위치가 아닌 실행 폴더를 쓴다(npm 스크립트·런처는 항상 루트에서 실행).
 * 루트가 아니면 엉뚱한 곳에 데이터를 만들지 않도록 바로 실패한다.
 */
function findProjectRoot(): string {
  const root = process.cwd();
  if (!existsSync(path.join(/*turbopackIgnore: true*/ root, "config", "defaults.json"))) {
    throw new ConfigError("visit-draft 폴더에서 실행해 주세요 (config/defaults.json을 찾을 수 없습니다).");
  }
  return root;
}

export const PROJECT_ROOT = findProjectRoot();

/** JSON 설정 파일을 읽고 스키마로 검증한다. 누락·형식 오류는 즉시 실패시킨다. */
export function loadJsonConfig<S extends z.ZodType>(relPath: string, schema: S): z.infer<S> {
  // 실행 시점 설정 파일. 빌드 추적 대상에서 뺀다(data/ 등 프로젝트 전체가 추적되지 않도록)
  const file = path.join(/*turbopackIgnore: true*/ PROJECT_ROOT, relPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`설정 파일을 읽을 수 없습니다: ${relPath} (${(err as Error).message})`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`설정 형식 오류: ${relPath}\n- ${issues.join("\n- ")}`);
  }
  return parsed.data;
}

export function loadSelectors(): Selectors {
  return loadJsonConfig("config/selectors.json", selectorsSchema);
}

export function loadDefaults(): Defaults {
  return loadJsonConfig("config/defaults.json", defaultsSchema);
}

/** 설정의 상대 경로를 프로젝트 루트 기준 절대 경로로 바꾼다. 루트 밖으로 나가는 경로는 거부한다. */
export function resolveDataPath(relPath: string): string {
  const abs = path.resolve(/*turbopackIgnore: true*/ PROJECT_ROOT, relPath);
  const rel = path.relative(PROJECT_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ConfigError(`프로젝트 폴더 밖의 경로는 사용할 수 없습니다: ${relPath}`);
  }
  return abs;
}

/** `{name}` 자리표시자를 URL 인코딩한 값으로 채운다. 값이 없는 자리표시자가 있으면 실패한다. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    if (v === undefined) throw new ConfigError(`URL 템플릿 값이 없습니다: {${key}}`);
    return encodeURIComponent(v);
  });
}
