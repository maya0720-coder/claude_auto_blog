import { describe, expect, it } from "vitest";
import { InvalidBlogUrlError, resolveBlogInput, resolveBlogUrl } from "../../src/lib/naver/blogUrl";

const HOSTS = ["blog.naver.com", "m.blog.naver.com"];

describe("resolveBlogUrl", () => {
  it.each([
    ["blog.naver.com/test_blog", { blogId: "test_blog" }],
    ["https://m.blog.naver.com/test_blog", { blogId: "test_blog" }],
    ["https://blog.naver.com/test_blog/223000000001", { blogId: "test_blog", logNo: "223000000001" }],
    [
      "https://blog.naver.com/PostList.naver?blogId=test_blog&categoryNo=12",
      { blogId: "test_blog", categoryNo: "12" },
    ],
    ["https://m.blog.naver.com/test_blog?categoryNo=12&tab=1", { blogId: "test_blog", categoryNo: "12" }],
    [
      "https://blog.naver.com/PostView.naver?blogId=test_blog&logNo=223000000001",
      { blogId: "test_blog", logNo: "223000000001" },
    ],
  ])("%s 를 해석한다", (input, expected) => {
    expect(resolveBlogUrl(input, HOSTS)).toEqual(expected);
  });

  it.each([
    ["https://example.com/test_blog", "허용되지 않은 호스트"],
    ["https://blog.naver.com.evil.com/test_blog", "비슷한 호스트"],
    ["javascript:alert(1)", "허용되지 않은 프로토콜"],
    ["https://blog.naver.com/", "블로그 ID 없음"],
    ["https://blog.naver.com/bad%20id", "ID 형식 오류"],
    ["https://blog.naver.com/test_blog/abc", "글 번호 형식 오류"],
    ["https://blog.naver.com/PostList.naver?blogId=test_blog&categoryNo=1;drop", "카테고리 형식 오류"],
    ["https://blog.naver.com/PostList.naver", "blogId 파라미터 없음"],
    ["", "빈 값"],
    [`https://blog.naver.com/${"a".repeat(3000)}`, "너무 긴 입력"],
  ])("%s 는 거부한다 (%s)", (input) => {
    expect(() => resolveBlogUrl(input, HOSTS)).toThrow(InvalidBlogUrlError);
  });
});

describe("resolveBlogInput", () => {
  it("블로그 ID만 받아도 된다", () => {
    expect(resolveBlogInput("test_blog", HOSTS)).toEqual({ blogId: "test_blog" });
  });
  it("예약 경로 이름은 ID로 보지 않는다", () => {
    expect(() => resolveBlogInput("PostList.naver", HOSTS)).toThrow(InvalidBlogUrlError);
  });
});
