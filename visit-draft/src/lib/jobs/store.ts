/**
 * 작업 저장소: data/jobs/<uuid>/ 아래에 job.json과 사진 파일을 둔다.
 *   original/  받은 원본(얼굴을 다시 가릴 때 필요, 보관 기간이 지나면 삭제)
 *   ai/        AI 분석용 작은 사본(얼굴 가림, EXIF 없음) — 외부로 보내는 것은 이것뿐
 *   upload/    네이버 업로드용 사본(얼굴 가림, EXIF 없음)
 * 경로는 모두 서버가 만든 ID로만 정하고, 요청 값을 경로에 그대로 쓰지 않는다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataPath } from "../config/load";
import type { Defaults } from "../config/schema";
import { jobSchema, type Job, type JobSummary, type Photo } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isValidJobId = (id: string) => UUID.test(id);

export type PhotoKind = "original" | "ai" | "upload";

export class JobStore {
  private readonly root: string;

  constructor(cfg: Defaults["jobs"]) {
    this.root = resolveDataPath(cfg.dir);
  }

  dir(id: string): string {
    if (!isValidJobId(id)) throw new Error("잘못된 작업 ID입니다.");
    return path.join(/*turbopackIgnore: true*/ this.root, id);
  }

  photoPath(id: string, photo: Pick<Photo, "id" | "ext">, kind: PhotoKind): string {
    const ext = kind === "original" ? photo.ext : ".jpg";
    return path.join(/*turbopackIgnore: true*/ this.dir(id), kind, `${photo.id}${ext}`);
  }

  create(job: Job): void {
    jobSchema.parse(job); // 잘못된 작업이면 폴더를 만들기 전에 실패한다
    const dir = this.dir(job.id);
    for (const sub of ["original", "ai", "upload"]) mkdirSync(path.join(/*turbopackIgnore: true*/ dir, sub), { recursive: true, mode: 0o700 });
    this.write(job);
  }

  /** 쓰는 도중 꺼져도 파일이 깨지지 않도록 임시 파일에 쓴 뒤 바꿔 넣는다. */
  write(job: Job): void {
    const valid = jobSchema.parse({ ...job, updatedAt: new Date().toISOString() });
    const file = path.join(/*turbopackIgnore: true*/ this.dir(job.id), "job.json");
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(valid, null, 2), "utf8");
    renameSync(tmp, file);
  }

  read(id: string): Job | undefined {
    const file = path.join(/*turbopackIgnore: true*/ this.dir(id), "job.json");
    if (!existsSync(file)) return undefined;
    const parsed = jobSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : undefined;
  }

  update(id: string, fn: (job: Job) => Job): Job {
    const job = this.read(id);
    if (!job) throw new Error("작업을 찾을 수 없습니다.");
    const next = fn(job);
    this.write(next);
    return next;
  }

  list(): JobSummary[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter(isValidJobId)
      .map((id) => this.read(id))
      .filter((j): j is Job => !!j)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => ({
        id: j.id,
        createdAt: j.createdAt,
        status: j.status,
        kind: j.input.kind,
        placeName: j.input.place.name,
        ...(j.draft ? { title: j.draft.title } : {}),
        photoCount: j.photos.length,
      }));
  }

  delete(id: string): void {
    rmSync(this.dir(id), { recursive: true, force: true });
  }

  /** 보관 기간이 지난 작업(사진 포함)을 지운다. 지운 개수를 돌려준다. */
  purgeOlderThan(days: number, now = Date.now()): number {
    if (!existsSync(this.root)) return 0;
    let removed = 0;
    for (const id of readdirSync(this.root).filter(isValidJobId)) {
      const file = path.join(/*turbopackIgnore: true*/ this.root, id, "job.json");
      const mtime = existsSync(file) ? statSync(file).mtimeMs : 0;
      if (now - mtime > days * 86_400_000) {
        this.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
