import { describe, expect, it } from "vitest";
import { loadDefaults, loadSelectors } from "../../src/lib/config/load";
import { InvalidImageError } from "../../src/lib/images/prepare";
import { checkFiles, JobInputError, parsePayload, type UploadFile } from "../../src/lib/jobs/create";
import { InvalidBlogUrlError } from "../../src/lib/naver/blogUrl";
import { ArgsError, buildPocArgs } from "../../src/lib/poc/args";
import { isValidRunId, RunBusyError, RunManager, UserFacingError } from "../../src/lib/runs/runManager";
import type { RunEvent } from "../../src/lib/runs/types";
import { checkLocalRequest } from "../../src/lib/server/localGuard";

const PORT = 3000;
const sel = loadSelectors();
const cfg = loadDefaults();
const headers = (h: Record<string, string>) => new Headers(h);

describe("checkLocalRequest", () => {
  it("루프백 Host의 GET은 허용한다", () => {
    expect(checkLocalRequest(headers({ host: "127.0.0.1:3000" }), "GET", PORT).ok).toBe(true);
    expect(checkLocalRequest(headers({ host: "localhost:3000" }), "GET", PORT).ok).toBe(true);
  });
  it.each<[Record<string, string>, string, string]>([
    [{ host: "evil.com" }, "GET", "다른 Host(DNS 리바인딩)"],
    [{ host: "127.0.0.1:3001" }, "GET", "다른 포트"],
    [{ host: "127.0.0.1:3000" }, "POST", "Origin 없음"],
    [{ host: "127.0.0.1:3000", origin: "https://evil.com" }, "POST", "다른 출처"],
    [{ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000.evil.com" }, "POST", "비슷한 출처"],
    [{ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000.evil.com" }, "DELETE", "DELETE도 출처 검사"],
  ])("%j %s 는 거부한다 (%s)", (h, method) => {
    expect(checkLocalRequest(headers(h), method, PORT)).toMatchObject({ ok: false, status: 403 });
  });
  it("같은 출처의 POST는 허용한다", () => {
    const h = headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" });
    expect(checkLocalRequest(h, "POST", PORT).ok).toBe(true);
  });
});

describe("parsePayload (새 작업 입력)", () => {
  const base = {
    blog: "https://blog.naver.com/PostList.naver?blogId=test_blog&categoryNo=7",
    place: { name: "테스트 카페", area: "서울 성동구", link: "https://map.naver.com/p/entry/place/123" },
    memo: { ordered: "아메리카노", rating: 4 },
    options: { faceMode: "mosaic", length: "normal", hashtagCount: 10, sortByTime: true },
    consent: true,
  };
  const parse = (over: Record<string, unknown>) => parsePayload(JSON.stringify({ ...base, ...over }), sel);

  it("블로그 주소에서 ID·카테고리를 읽는다", () => {
    expect(parse({})).toMatchObject({ blogId: "test_blog", categoryNo: "7", place: { name: "테스트 카페" } });
  });
  it("카테고리 칸 값이 주소보다 우선한다", () => {
    expect(parse({ category: "12" }).categoryNo).toBe("12");
  });
  it.each<[string, Record<string, unknown>]>([
    ["동의 없음", { consent: false }],
    ["장소 이름 없음", { place: { name: "" } }],
    ["http가 아닌 링크", { place: { name: "a", link: "javascript:alert(1)" } }],
    ["알 수 없는 얼굴 옵션", { options: { ...base.options, faceMode: "blur" } }],
    ["별점 범위 밖", { memo: { rating: 9 } }],
    ["해시태그 개수 범위 밖", { options: { ...base.options, hashtagCount: 99 } }],
  ])("거부: %s", (_, over) => {
    expect(() => parse(over)).toThrow(JobInputError);
  });
  it("외부 블로그 주소·깨진 JSON은 거부한다", () => {
    expect(() => parse({ blog: "https://evil.com/x" })).toThrow(InvalidBlogUrlError);
    expect(() => parsePayload("{", sel)).toThrow(JobInputError);
  });
});

describe("checkFiles", () => {
  const f = (name: string, size = 10): UploadFile => ({ name, size, arrayBuffer: async () => new ArrayBuffer(size) });
  it("확장자를 돌려준다", () => {
    expect(checkFiles([f("a.JPG"), f("b.png")], cfg.images)).toEqual([".jpg", ".png"]);
  });
  it.each<[string, UploadFile[]]>([
    ["0장", []],
    ["21장", Array.from({ length: 21 }, (_, i) => f(`${i}.jpg`))],
    ["형식", [f("a.exe")]],
    ["빈 파일", [f("a.jpg", 0)]],
    ["크기 초과", [f("a.jpg", cfg.images.maxBytes + 1)]],
  ])("거부: %s", (_, files) => {
    expect(() => checkFiles(files, cfg.images)).toThrow(InvalidImageError);
  });
});

describe("buildPocArgs", () => {
  const hosts = sel.blog.allowedHosts;
  it("과거 글 분석만이면 사진 없이 통과", () => {
    expect(buildPocArgs({ blog: "test_blog", images: [], skipSave: true }, hosts)).toMatchObject({ blogId: "test_blog", skipSave: true });
  });
  it("빈 블로그·사진 없음은 거부", () => {
    expect(() => buildPocArgs({ blog: " ", images: ["a"] }, hosts)).toThrow(ArgsError);
    expect(() => buildPocArgs({ blog: "test_blog", images: [] }, hosts)).toThrow(ArgsError);
  });
});

describe("RunManager", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("동시에 하나만 실행하고, 늦게 연결해도 처음부터 받으며, 끝나면 정리 함수를 부른다", async () => {
    const m = new RunManager();
    let release!: () => void;
    let cleaned = false;
    const run = m.start(
      "job-1",
      "generate",
      (emit) => {
        emit({ type: "step", step: "photos", status: "running" });
        return new Promise<void>((r) => (release = r));
      },
      () => (cleaned = true),
    );
    expect(isValidRunId(run.runId)).toBe(true);
    expect(m.active).toEqual({ runId: run.runId, jobId: "job-1", kind: "generate" });
    expect(() => m.start("job-2", "save", async () => {})).toThrow(RunBusyError);

    const seen: RunEvent[] = [];
    m.subscribe(run.runId, (e) => seen.push(e));
    expect(seen).toEqual([{ type: "step", step: "photos", status: "running" }]);
    release();
    await tick();
    expect(seen.at(-1)).toEqual({ type: "done" });
    expect(m.active).toBeUndefined();
    expect(cleaned).toBe(true);
  });

  it("UserFacingError는 문구 그대로, 그 밖의 오류는 한 줄 요약으로 전달한다", async () => {
    const m = new RunManager();
    const a = m.start("j", "save", async () => {
      throw new UserFacingError("오늘 한도를 다 썼습니다.");
    });
    await tick();
    expect(m.get(a.runId)?.events.at(-1)).toEqual({ type: "error", message: "오늘 한도를 다 썼습니다." });
    const b = m.start("j", "save", async () => {
      throw new Error("내부 실패\nat secret/path.ts:1");
    });
    await tick();
    const last = m.get(b.runId)?.events.at(-1);
    expect(last).toMatchObject({ type: "error" });
    expect(JSON.stringify(last)).not.toContain("secret/path");
  });
});
