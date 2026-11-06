import { parseArgs } from "node:util";
import { isValidCategoryNo, resolveBlogInput } from "../naver/blogUrl";

export interface PocArgs {
  blogId: string;
  categoryNo?: string;
  images: string[];
  title: string;
  skipRead: boolean;
  skipSave: boolean;
}

/** 명령줄·웹 폼 공통 입력 */
export interface PocInput {
  blog: string;
  category?: string | undefined;
  images: string[];
  title?: string | undefined;
  skipRead?: boolean;
  skipSave?: boolean;
}

export class ArgsError extends Error {
  override name = "ArgsError";
}

export const MAX_TITLE = 100;

export const USAGE = `사용법:
  npm run poc -- --blog <블로그ID 또는 주소> [--category <카테고리 번호>] --images a.jpg,b.jpg,c.jpg
옵션:
  --title <제목>   임시저장 글 제목 (기본: "[PoC] 임시저장 테스트 <날짜>")
  --skip-read      ② 과거 글 조회를 건너뜀
  --skip-save      ③④ 글쓰기·임시저장을 건너뜀 (사진 불필요)`;

/** 입력을 검증해 PoC 실행 인자로 만든다. 명령줄과 웹이 같은 규칙을 쓴다. */
export function buildPocArgs(input: PocInput, allowedHosts: readonly string[], now = new Date()): PocArgs {
  if (!input.blog?.trim()) throw new ArgsError("블로그 ID 또는 주소가 필요합니다.");
  const ref = resolveBlogInput(input.blog, allowedHosts);

  const category = input.category?.trim() || ref.categoryNo;
  if (category !== undefined && !isValidCategoryNo(category)) {
    throw new ArgsError("카테고리 번호는 숫자여야 합니다.");
  }

  const skipSave = input.skipSave ?? false;
  const images = input.images.map((s) => s.trim()).filter(Boolean);
  if (!skipSave && images.length === 0) throw new ArgsError("사진이 1장 이상 필요합니다.");

  const title = (input.title?.trim() || `[PoC] 임시저장 테스트 ${now.toISOString().slice(0, 10)}`).trim();
  if (title.length > MAX_TITLE) throw new ArgsError(`제목은 ${MAX_TITLE}자 이하여야 합니다.`);

  const args: PocArgs = { blogId: ref.blogId, images, title, skipRead: input.skipRead ?? false, skipSave };
  if (category !== undefined) args.categoryNo = category;
  return args;
}

export function parsePocArgs(argv: string[], allowedHosts: readonly string[], now = new Date()): PocArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        blog: { type: "string" },
        category: { type: "string" },
        images: { type: "string" },
        title: { type: "string" },
        "skip-read": { type: "boolean", default: false },
        "skip-save": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    throw new ArgsError((err as Error).message);
  }
  if (values.title !== undefined && values.title.trim() === "") throw new ArgsError("--title이 비어 있습니다.");

  return buildPocArgs(
    {
      blog: values.blog ?? "",
      category: values.category,
      images: (values.images ?? "").split(","),
      title: values.title,
      skipRead: values["skip-read"] ?? false,
      skipSave: values["skip-save"] ?? false,
    },
    allowedHosts,
    now,
  );
}
