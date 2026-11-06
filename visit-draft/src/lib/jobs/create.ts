/**
 * 화면에서 받은 입력(multipart)으로 작업을 만든다. 입력값은 모두 서버에서 다시 검증한다.
 * 사진 파일 이름은 사용자 값을 쓰지 않고 p1, p2…로 새로 붙인다(경로 탐색 방지).
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Defaults, Selectors } from "../config/schema";
import { InvalidImageError } from "../images/prepare";
import { InvalidBlogUrlError, resolveBlogInput } from "../naver/blogUrl";
import type { JobStore } from "./store";
import { jobInputSchema, type Job, type JobInput } from "./types";

export class JobInputError extends Error {
  override name = "JobInputError";
}

/** 화면이 보내는 JSON(payload 필드) */
const payloadSchema = z.object({
  blog: z.string().trim().min(1, "블로그 주소 또는 ID를 입력해 주세요.").max(2048),
  category: z.string().trim().max(10).optional(),
  kind: jobInputSchema.shape.kind,
  /** 참고할 다른 네이버 블로그 주소(선택) */
  template: z.string().trim().max(2048).optional(),
  place: jobInputSchema.shape.place,
  memo: jobInputSchema.shape.memo,
  options: jobInputSchema.shape.options,
  consent: z.literal(true, { message: "외부 전송 안내에 동의해 주세요." }),
});

export interface UploadFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export function parsePayload(raw: string, sel: Selectors): JobInput {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new JobInputError("요청 형식이 올바르지 않습니다.");
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) throw new JobInputError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  const p = parsed.data;
  const ref = resolveBlogInput(p.blog, sel.blog.allowedHosts);
  const categoryNo = p.category || ref.categoryNo;
  const template = p.template ? resolveTemplate(p.template, sel.blog.allowedHosts) : undefined;
  const input = {
    kind: p.kind,
    blogId: ref.blogId,
    ...(categoryNo ? { categoryNo } : {}),
    ...(template ? { template } : {}),
    place: p.place,
    memo: p.memo,
    options: p.options,
  };
  const checked = jobInputSchema.safeParse(input);
  if (!checked.success) throw new JobInputError(checked.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  return checked.data;
}

/** 참고 블로그 주소 → 블로그 ID(+글 번호). 네이버 블로그만 받는다 */
function resolveTemplate(raw: string, allowedHosts: readonly string[]): { blogId: string; logNo?: string } {
  try {
    const ref = resolveBlogInput(raw, allowedHosts);
    return { blogId: ref.blogId, ...(ref.logNo ? { logNo: ref.logNo } : {}) };
  } catch (err) {
    if (err instanceof InvalidBlogUrlError) throw new JobInputError(`참고 블로그: ${err.message}`);
    throw err;
  }
}

export function checkFiles(files: UploadFile[], cfg: Defaults["images"]): string[] {
  if (files.length === 0) throw new InvalidImageError("사진을 1장 이상 올려 주세요.");
  if (files.length > cfg.jobMaxCount) throw new InvalidImageError(`사진은 최대 ${cfg.jobMaxCount}장까지 올릴 수 있습니다.`);
  return files.map((f, i) => {
    const ext = path.extname(f.name).toLowerCase();
    if (!cfg.allowedExtensions.includes(ext)) {
      throw new InvalidImageError(`사진 ${i + 1}: 지원하지 않는 형식입니다 (${cfg.allowedExtensions.join(", ")}).`);
    }
    if (f.size <= 0 || f.size > cfg.maxBytes) {
      throw new InvalidImageError(`사진 ${i + 1}: 파일이 비어 있거나 ${Math.round(cfg.maxBytes / 1048576)}MB를 넘습니다.`);
    }
    return ext;
  });
}

/** 작업 폴더를 만들고 원본 사진을 저장한다. 실패하면 만든 폴더를 지운다. */
export async function createJob(input: JobInput, files: UploadFile[], exts: string[], store: JobStore): Promise<Job> {
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "processing",
    input,
    photos: files.map((_, i) => ({ id: `p${i + 1}`, ext: exts[i]!, faces: [], aiWidth: 1 })),
  };
  store.create(job);
  try {
    for (const [i, f] of files.entries()) {
      writeFileSync(store.photoPath(job.id, job.photos[i]!, "original"), Buffer.from(await f.arrayBuffer()));
    }
  } catch (err) {
    store.delete(job.id);
    throw err;
  }
  return job;
}
