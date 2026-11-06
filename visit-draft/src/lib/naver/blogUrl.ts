export interface BlogRef {
  blogId: string;
  categoryNo?: string;
  logNo?: string;
}

export class InvalidBlogUrlError extends Error {
  override name = "InvalidBlogUrlError";
}

const BLOG_ID = /^[A-Za-z0-9_-]{1,40}$/;
const NUMERIC_ID = /^\d{1,20}$/;
const MAX_INPUT_LENGTH = 2048;
/** blogId 자리에 올 수 없는 네이버 블로그 경로 이름 */
const RESERVED_PATHS = new Set(["PostList.naver", "PostView.naver", "postwrite"]);

export function isValidBlogId(value: string): boolean {
  return BLOG_ID.test(value) && !RESERVED_PATHS.has(value);
}

/**
 * 네이버 블로그 주소를 해석한다(설계서 F4).
 * 허용 호스트 목록 밖의 주소, 형식이 맞지 않는 ID는 거부한다.
 */
export function resolveBlogUrl(input: string, allowedHosts: readonly string[]): BlogRef {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) {
    throw new InvalidBlogUrlError("블로그 주소가 비어 있거나 너무 깁니다.");
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new InvalidBlogUrlError("블로그 주소 형식이 올바르지 않습니다.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new InvalidBlogUrlError("네이버 블로그 주소만 사용할 수 있습니다.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  let ref: BlogRef;

  if (first === "PostList.naver" || first === "PostView.naver") {
    const blogId = url.searchParams.get("blogId") ?? "";
    ref = { blogId };
    const categoryNo = url.searchParams.get("categoryNo");
    const logNo = url.searchParams.get("logNo");
    if (categoryNo) ref.categoryNo = categoryNo;
    if (logNo) ref.logNo = logNo;
  } else if (first) {
    ref = { blogId: first };
    if (segments[1]) ref.logNo = segments[1];
    // 모바일 카테고리 주소: m.blog.naver.com/{blogId}?categoryNo=12
    const categoryNo = url.searchParams.get("categoryNo");
    if (categoryNo) ref.categoryNo = categoryNo;
  } else {
    throw new InvalidBlogUrlError("주소에 블로그 ID가 없습니다.");
  }

  if (!isValidBlogId(ref.blogId)) throw new InvalidBlogUrlError("블로그 ID 형식이 올바르지 않습니다.");
  if (ref.logNo !== undefined && !NUMERIC_ID.test(ref.logNo)) {
    throw new InvalidBlogUrlError("글 번호 형식이 올바르지 않습니다.");
  }
  if (ref.categoryNo !== undefined && !NUMERIC_ID.test(ref.categoryNo)) {
    throw new InvalidBlogUrlError("카테고리 번호 형식이 올바르지 않습니다.");
  }
  return ref;
}

/** 블로그 ID 또는 주소를 받아 해석한다. */
export function resolveBlogInput(input: string, allowedHosts: readonly string[]): BlogRef {
  const trimmed = input.trim();
  if (isValidBlogId(trimmed)) return { blogId: trimmed };
  return resolveBlogUrl(trimmed, allowedHosts);
}

export function isValidCategoryNo(value: string): boolean {
  return NUMERIC_ID.test(value);
}
