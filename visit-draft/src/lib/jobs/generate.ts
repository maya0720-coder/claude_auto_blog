/**
 * 원고 만들기 파이프라인: 사진 준비 → AI 사진 분석 → 블로그 문체(또는 참고 블로그 템플릿) → 정보 조사 → 원고 작성.
 * 사진 분석·문체·조사는 실패해도 계속 진행하고(경고 표시), 사진 준비·원고 작성 실패는 작업 실패로 처리한다.
 */
import { aiErrorMessage, analyzePhotos, researchPlace, writeDraft } from "../ai/provider";
import type { Defaults, Selectors } from "../config/schema";
import { preparePhotos, sortByTakenAt } from "../images/process";
import { buildStyleNote } from "../naver/styleNote";
import { UserFacingError } from "../runs/runManager";
import type { RunEvent } from "../runs/types";
import { errorSummary } from "../util/common";
import type { JobStore } from "./store";
import { ensureDisclosure, type Job } from "./types";

/** 처음부터 다시 만들 때 지난 결과가 남지 않도록 필드를 지운다 */
function omit<K extends keyof Job>(job: Job, key: K): Job {
  const next = { ...job };
  delete next[key];
  return next;
}

export interface GenerateOptions {
  /** false면 사진 준비·문체·조사를 건너뛰고 원고만 다시 쓴다 */
  full: boolean;
}

export async function runGenerate(
  jobId: string,
  store: JobStore,
  cfg: Defaults,
  sel: Selectors,
  emit: (e: RunEvent) => void,
  opts: GenerateOptions,
): Promise<void> {
  const fail = (message: string): never => {
    store.update(jobId, (j) => ({ ...j, status: "failed", error: message }));
    throw new UserFacingError(message);
  };
  const step = (s: string, status: "running" | "ok" | "warning" | "failed" | "skipped", message?: string) =>
    emit({ type: "step", step: s, status, ...(message ? { message } : {}) });

  let job = store.update(jobId, (j) => {
    const next = { ...j, status: "processing" as const };
    delete next.error;
    return next;
  });

  if (opts.full) {
    step("photos", "running");
    try {
      const photos = await preparePhotos(store, jobId, job.photos, job.input.options.faceMode, cfg, (done, total, faces) =>
        emit({ type: "log", message: `사진 ${done}/${total} 준비 완료${faces ? ` (얼굴 ${faces}명 가림)` : ""}` }),
      );
      const ordered = job.input.options.sortByTime ? sortByTakenAt(photos) : photos;
      job = store.update(jobId, (j) => ({ ...j, photos: ordered }));
      const faceTotal = ordered.reduce((n, p) => n + p.faces.length, 0);
      step("photos", "ok", `사진 ${ordered.length}장, 얼굴 ${faceTotal}명 가림`);
    } catch (err) {
      step("photos", "failed");
      // 얼굴을 가리지 못한 사진이 외부로 나가지 않도록 여기서 멈춘다
      fail(`사진을 준비하지 못했습니다. (${errorSummary(err)})`);
    }

    step("analyze", "running");
    try {
      const photoNotes = await analyzePhotos(job, store, cfg.ai);
      job = store.update(jobId, (j) => ({ ...j, photoNotes }));
      const kinds = [...new Set(photoNotes.map((n) => n.category))].slice(0, 5).join(", ");
      step("analyze", "ok", `사진 ${photoNotes.length}장 분석: ${kinds}`);
    } catch (err) {
      job = store.update(jobId, (j) => omit(j, "photoNotes"));
      step("analyze", "warning", `사진 분석에 실패해 원고 작성 때 사진을 직접 봅니다. (${aiErrorMessage(err)})`);
    }

    const tpl = job.input.template;
    step("style", "running");
    try {
      const styleNote = await buildStyleNote(tpl ? { ...tpl, template: true } : { blogId: job.input.blogId }, cfg, sel);
      job = store.update(jobId, (j) => ({ ...j, styleNote }));
      step("style", "ok", tpl ? `참고 블로그(${tpl.blogId}${tpl.logNo ? `의 글 ${tpl.logNo}` : ""})의 구성을 따릅니다` : undefined);
    } catch (err) {
      job = store.update(jobId, (j) => omit(j, "styleNote"));
      step("style", "warning", `${tpl ? "참고 블로그" : "내 블로그"} 글을 읽지 못해 기본 문체로 씁니다. (${errorSummary(err)})`);
    }

    step("research", "running");
    try {
      const research = await researchPlace(job.input, cfg.ai, job.photoNotes);
      job = store.update(jobId, (j) => ({ ...j, research }));
      step("research", "ok", `확인한 정보 ${research.facts.length}개, 출처 ${research.sources.length}곳`);
    } catch (err) {
      job = store.update(jobId, (j) => omit(j, "research"));
      step("research", "warning", `정보 조사에 실패해 사실 정보 없이 씁니다. (${aiErrorMessage(err)})`);
    }
  }

  step("write", "running");
  try {
    const draft = ensureDisclosure(await writeDraft(job, store, cfg.ai), job.input.options.disclosure);
    store.update(jobId, (j) => ({ ...j, draft, status: "draft_ready" }));
    step("write", "ok");
  } catch (err) {
    step("write", "failed");
    fail(aiErrorMessage(err));
  }
}
