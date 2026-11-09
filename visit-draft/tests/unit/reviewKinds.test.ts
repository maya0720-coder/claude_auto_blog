/**
 * 후기 종류(장소/제품)·글 길이·참고 블로그 템플릿·AI 사진 분석 결과 검증.
 * 외부 서비스는 부르지 않는다(블로그 읽기는 가짜 요청 객체로 대신함).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePhotoNotes } from "../../src/lib/ai/photoNotes";
import { AiError, researchPromptName, researchUserPrompt, writerContext } from "../../src/lib/ai/shared";
import { loadSelectors } from "../../src/lib/config/load";
import { JobInputError, parsePayload } from "../../src/lib/jobs/create";
import { memoLines } from "../../src/lib/jobs/reviewKinds";
import { jobInputSchema, type Job } from "../../src/lib/jobs/types";
import { readSinglePost, type HttpGetter } from "../../src/lib/naver/blogReader";

const sel = loadSelectors();
const base = {
  blog: "test_blog",
  place: { name: "OO 무선 청소기 V12", area: "OO전자" },
  memo: { visitedOn: "2주 사용", good: "가벼워요" },
  options: { faceMode: "mosaic", length: "long", hashtagCount: 5, sortByTime: true },
  consent: true,
};
const parse = (over: Record<string, unknown>) => parsePayload(JSON.stringify({ ...base, ...over }), sel);

describe("입력: 후기 종류·길이·참고 블로그", () => {
  it("제품 후기와 참고 블로그 글 주소(블로그 ID + 글 번호)를 받는다", () => {
    const input = parse({ kind: "product", template: "https://blog.naver.com/other_blog/223456789012" });
    expect(input.kind).toBe("product");
    expect(input.template).toEqual({ blogId: "other_blog", logNo: "223456789012" });
    expect(input.options.length).toBe("long");
  });
  it("종류를 안 보내면 장소 후기, 참고 블로그가 없으면 template 없음", () => {
    const input = parse({});
    expect(input.kind).toBe("place");
    expect(input.template).toBeUndefined();
  });
  it("네이버가 아닌 참고 블로그 주소·알 수 없는 종류는 거부한다", () => {
    expect(() => parse({ template: "https://evil.example.com/a" })).toThrow(JobInputError);
    expect(() => parse({ template: "https://evil.example.com/a" })).toThrow(/참고 블로그/);
    expect(() => parse({ kind: "car" })).toThrow(JobInputError);
  });
  it("짧은 글은 없어졌다: 예전 작업의 short는 중간 글로 읽고, 새 입력의 다른 값은 거부한다", () => {
    const old = jobInputSchema.parse({ blogId: "a", place: { name: "x" }, memo: {}, options: { ...base.options, length: "short" } });
    expect(old.options.length).toBe("normal");
    expect(old.kind).toBe("place");
    expect(() => parse({ options: { ...base.options, length: "tiny" } })).toThrow(JobInputError);
  });
});

describe("AI 요청 문구", () => {
  const job = (over: Partial<Job["input"]>): Job => ({
    id: "77777777-2222-4333-8444-555555555555",
    createdAt: "t",
    updatedAt: "t",
    status: "processing",
    input: { kind: "product", blogId: "me", place: base.place, memo: base.memo, options: { faceMode: "mosaic", length: "long", hashtagCount: 5, sortByTime: true }, ...over },
    photos: [{ id: "p1", ext: ".jpg", faces: [], aiWidth: 10 }],
    photoNotes: [{ photoId: "p1", category: "제품 전체", description: "흰색 청소기", visibleText: "V12", caption: "청소기 전체 모습" }],
    styleNote: "### 참고 글 1\n[사진 1장]",
  });

  it("제품 후기는 제품 조사 프롬프트, 메모는 제품용 이름으로 넘긴다", () => {
    expect(researchPromptName("product")).toBe("research-product");
    expect(researchPromptName("place")).toBe("research");
    expect(memoLines("product", base.memo)).toEqual(["사용 기간: 2주 사용", "좋았던 점: 가벼워요"]);
    expect(memoLines("place", base.memo)[0]).toBe("방문일: 2주 사용");
  });
  it("조사 요청에 사진에서 읽은 글자를 단서로 넣는다", () => {
    const j = job({});
    const text = researchUserPrompt(j.input, j.photoNotes);
    expect(text).toContain("조사할 제품: OO 무선 청소기 V12");
    expect(text).toContain("브랜드 힌트: OO전자");
    expect(text).toContain("p1: V12");
  });
  it("원고 요청: 사진 분석·길이 안내, 참고 블로그면 '문장은 베끼지 않음'을 붙인다", () => {
    const mine = writerContext(job({}));
    expect(mine).toContain("제품 사용 후기");
    expect(mine).toContain("청소기 전체 모습");
    expect(mine).toContain("긴 글");
    expect(mine).toContain("블로그 문체 참고(내 블로그)");
    const tpl = writerContext(job({ template: { blogId: "other_blog" } }));
    expect(tpl).toContain("글 템플릿 참고");
    expect(tpl).toContain("베끼지 않음");
  });
});

describe("parsePhotoNotes", () => {
  it("모르는 사진·중복·형식 오류는 버리고 사진 순서로 정렬한다", () => {
    const text = JSON.stringify({
      photos: [
        { photoId: "p2", category: "음식", description: "파스타", visibleText: "", caption: "파스타 한 접시" },
        { photoId: "p1", category: "외관", description: "가게 앞", visibleText: "CAFE", caption: "외관" },
        { photoId: "p1", category: "중복", description: "x", visibleText: "", caption: "x" },
        { photoId: "p7", category: "없음", description: "x", visibleText: "", caption: "x" },
        { photoId: "p3", category: "", description: "", caption: "" },
      ],
    });
    const notes = parsePhotoNotes(text, ["p1", "p2", "p3"]);
    expect(notes.map((n) => n.photoId)).toEqual(["p1", "p2"]);
    expect(notes[1]!.visibleText).toBeUndefined();
  });
  it("JSON이 아니거나 남는 것이 없으면 AiError", () => {
    expect(() => parsePhotoNotes("oops", ["p1"])).toThrow(AiError);
    expect(() => parsePhotoNotes(JSON.stringify({ photos: [] }), ["p1"])).toThrow(AiError);
  });
});

describe("readSinglePost (참고 블로그 글 한 편)", () => {
  const html = readFileSync(path.join(import.meta.dirname, "../fixtures", "se-post.html"), "utf8");
  const fakeRequest = (status: number, body: string, seen: string[]) =>
    ({
      get: async (url: string) => {
        seen.push(url);
        return { ok: () => status < 400, status: () => status, text: async () => body };
      },
    }) satisfies HttpGetter;

  it("지정한 글만 읽어 구성 발췌를 만든다", async () => {
    const seen: string[] = [];
    const r = await readSinglePost(fakeRequest(200, html, seen), "other_blog", "223456789012", sel.blog, 5000, 4000);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("other_blog");
    expect(seen[0]).toContain("223456789012");
    expect(r.parsedOk).toBe(1);
    expect(r.excerpts[0]).toContain("[사진");
  });
  it("본문을 찾지 못하거나 HTTP 오류면 실패한다", async () => {
    await expect(readSinglePost(fakeRequest(200, "<html></html>", []), "b", "1", sel.blog, 5000, 4000)).rejects.toThrow();
    await expect(readSinglePost(fakeRequest(404, "", []), "b", "1", sel.blog, 5000, 4000)).rejects.toThrow(/404/);
  });
});
