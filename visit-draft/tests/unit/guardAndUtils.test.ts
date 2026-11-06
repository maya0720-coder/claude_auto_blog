import { describe, expect, it } from "vitest";
import { ConfigError, fillTemplate, loadDefaults, loadSelectors, resolveDataPath } from "../../src/lib/config/load";
import { isForbidden } from "../../src/lib/naver/publishGuard";
import { errorSummary, maskId, withRetry } from "../../src/lib/util/common";
import { ArgsError, parsePocArgs } from "../../src/lib/poc/args";
import { InvalidBlogUrlError } from "../../src/lib/naver/blogUrl";

const sel = loadSelectors();
const rules = sel.editor.forbidden;

describe("설정 파일", () => {
  it("selectors.json과 defaults.json이 스키마를 통과한다", () => {
    expect(() => loadSelectors()).not.toThrow();
    expect(() => loadDefaults()).not.toThrow();
  });
  it("발행 차단 규칙이 비어 있지 않다", () => {
    expect(rules.texts).toContain("발행");
    expect(rules.classFragments).toContain("publish_btn");
  });
});

describe("isForbidden (발행 가드)", () => {
  it.each([
    [{ texts: ["발행"], classNames: [] }],
    [{ texts: ["  공개\n발행  "], classNames: [] }],
    [{ texts: [], classNames: ["publish_btn__abc tag:button"] }],
    [{ texts: ["→"], classNames: ["PUBLISH_BTN"] }],
    [{ texts: ["예약 발행"], classNames: [] }],
    [{ texts: [], classNames: [] }], // 정보 없음 → 안전하게 거부
  ])("%j 는 차단한다", (info) => {
    expect(isForbidden(info, rules)).toBe(true);
  });

  it.each([
    [{ texts: ["저장"], classNames: ["save_btn__abc", "tag:button"] }],
    [{ texts: ["사진"], classNames: ["se-image-toolbar-button"] }],
    [{ texts: ["취소"], classNames: ["se-popup-button-cancel"] }],
  ])("%j 는 허용한다", (info) => {
    expect(isForbidden(info, rules)).toBe(false);
  });
});

describe("config helpers", () => {
  it("템플릿 값을 URL 인코딩한다", () => {
    expect(fillTemplate("https://x/{a}?c={b}", { a: "a/b", b: "" })).toBe("https://x/a%2Fb?c=");
  });
  it("템플릿 값이 없으면 실패한다", () => {
    expect(() => fillTemplate("{a}", {})).toThrow(ConfigError);
  });
  it("프로젝트 밖 경로를 거부한다", () => {
    expect(() => resolveDataPath("../outside")).toThrow(ConfigError);
    expect(resolveDataPath("data/poc")).toMatch(/data[\\/]poc$/);
  });
});

describe("common utils", () => {
  it("maskId", () => {
    expect(maskId("test_blog")).toBe("te******");
    expect(maskId("ab")).toBe("**");
  });
  it("errorSummary는 첫 줄만, 스택 없이", () => {
    const e = new Error("line1\nline2 secret path");
    expect(errorSummary(e)).toBe("Error: line1");
    expect(errorSummary("x")).toBe("알 수 없는 오류");
  });
  it("withRetry는 재시도 후 성공한다", async () => {
    let n = 0;
    await expect(withRetry(2, async () => (++n < 3 ? Promise.reject(new Error("x")) : "ok"))).resolves.toBe("ok");
    expect(n).toBe(3);
  });
  it("withRetry는 재시도 불가 오류에서 바로 멈춘다", async () => {
    let n = 0;
    const run = withRetry(
      2,
      async () => {
        n++;
        throw new ArgsError("stop");
      },
      (err) => !(err instanceof ArgsError),
    );
    await expect(run).rejects.toThrow("stop");
    expect(n).toBe(1);
  });
});

describe("parsePocArgs", () => {
  const hosts = sel.blog.allowedHosts;
  const now = new Date("2026-11-06T00:00:00Z");

  it("정상 입력", () => {
    expect(parsePocArgs(["--blog", "test_blog", "--category", "3", "--images", "a.jpg, b.jpg"], hosts, now)).toEqual({
      blogId: "test_blog",
      categoryNo: "3",
      images: ["a.jpg", "b.jpg"],
      title: "[PoC] 임시저장 테스트 2026-11-06",
      skipRead: false,
      skipSave: false,
    });
  });
  it("주소의 categoryNo를 쓴다", () => {
    const a = parsePocArgs(
      ["--blog", "https://blog.naver.com/PostList.naver?blogId=test_blog&categoryNo=7", "--skip-save"],
      hosts,
      now,
    );
    expect(a.categoryNo).toBe("7");
    expect(a.images).toEqual([]);
  });
  it.each([
    [[], ArgsError],
    [["--blog", "test_blog"], ArgsError], // 사진 없음
    [["--blog", "test_blog", "--images", "a.jpg", "--category", "x"], ArgsError],
    [["--blog", "test_blog", "--images", "a.jpg", "--title", "a".repeat(101)], ArgsError],
    [["--blog", "test_blog", "--unknown"], ArgsError],
    [["--blog", "https://evil.com/x", "--skip-save"], InvalidBlogUrlError],
  ])("%j 는 거부한다", (argv, errType) => {
    expect(() => parsePocArgs(argv, hosts, now)).toThrow(errType);
  });
});
