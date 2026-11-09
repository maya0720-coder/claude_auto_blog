/**
 * 방문 정보 블록(네이버 지도·예약 링크), 조사 결과의 예약 링크 검사, 이모지 분리, 업로드 사진 최소 폭 검증.
 * 외부 서비스는 부르지 않는다.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseResearch } from "../../src/lib/ai/shared";
import { uploadCopy } from "../../src/lib/images/process";
import { isNaverBookingUrl, MAP_SEARCH_URL, PLACE_INFO_HEADER, placeInfoBlock, placeLinks, withPlaceInfo } from "../../src/lib/jobs/placeInfo";
import type { Job, PlaceResearch } from "../../src/lib/jobs/types";
import { splitEmoji, withoutEmoji } from "../../src/lib/naver/textSegments";

const research: PlaceResearch = {
  summary: "s",
  facts: [
    { label: "정식 상호", value: "비스타밸리", source: "https://example.com/a" },
    { label: "도로명 주소", value: "경기도 남양주시 화도읍 어딘가로 1" },
    { label: "운영시간", value: "10:00~19:00 (출처마다 다름)" },
    { label: "주차", value: "무료 주차 가능" },
  ],
  sources: ["https://example.com/a"],
  links: { naverBooking: "https://booking.naver.com/booking/6/bizes/123456" },
  checkedAt: "t",
};
const job = (over: { link?: string; kind?: "place" | "product"; research?: PlaceResearch }): Pick<Job, "input" | "research"> => ({
  input: {
    kind: over.kind ?? "place",
    blogId: "me",
    place: { name: "비스타벨리", area: "남양주", ...(over.link ? { link: over.link } : {}) },
    memo: {},
    options: { faceMode: "mosaic", length: "normal", hashtagCount: 5, sortByTime: true },
  },
  ...(over.research ? { research: over.research } : {}),
});

describe("네이버 지도·예약 링크", () => {
  it("사용자가 준 네이버 지도 단축 링크를 그대로 쓴다", () => {
    expect(placeLinks(job({ link: "https://naver.me/5ZSm4rjb", research }))).toEqual({
      map: "https://naver.me/5ZSm4rjb",
      mapFromUser: true,
      booking: "https://booking.naver.com/booking/6/bizes/123456",
    });
  });
  it("네이버 지도 링크가 없으면 조사한 정식 이름 + 지역으로 지도 검색 링크를 만든다", () => {
    const l = placeLinks(job({ link: "https://www.vista-valley.co.kr", research }));
    expect(l.mapFromUser).toBe(false);
    expect(l.map).toBe(MAP_SEARCH_URL + encodeURIComponent("비스타밸리 남양주"));
  });
  it("예약 링크는 네이버 예약 상세 주소 형식만 받는다", () => {
    expect(isNaverBookingUrl("https://booking.naver.com/booking/6/bizes/123456")).toBe(true);
    expect(isNaverBookingUrl("https://m.booking.naver.com/booking/12/bizes/1/items/22?x=1")).toBe(true);
    expect(isNaverBookingUrl("https://booking.naver.com/")).toBe(false);
    expect(isNaverBookingUrl("https://evil.example.com/booking/6/bizes/1")).toBe(false);
    expect(isNaverBookingUrl("javascript:alert(1)")).toBe(false);
  });
  it("조사 결과의 예약 링크가 형식에 안 맞으면 버린다", () => {
    const text = (b: string) => JSON.stringify({ summary: "s", facts: [], sources: [], links: { naverBooking: b } });
    expect(parseResearch(text("https://booking.naver.com/booking/6/bizes/99"), "t").links).toEqual({
      naverBooking: "https://booking.naver.com/booking/6/bizes/99",
    });
    expect(parseResearch(text("https://example.com/reserve"), "t").links).toBeUndefined();
  });
});

describe("방문 정보 블록", () => {
  it("주소·운영시간·주차와 링크를 정리하고, 조사용 메모(출처마다 다름)는 빼고, 끝에 한 번만 붙인다", () => {
    const block = placeInfoBlock(job({ research }));
    expect(block?.type).toBe("text");
    const text = block?.type === "text" ? block.text : "";
    expect(text.startsWith(PLACE_INFO_HEADER)).toBe(true);
    expect(text).toContain("· 주소: 경기도 남양주시 화도읍 어딘가로 1");
    expect(text).toContain("· 운영시간: 10:00~19:00");
    expect(text).not.toContain("출처마다");
    expect(text).toContain("🗺️ 네이버 지도: https://map.naver.com/p/search/");
    expect(text).toContain("📅 네이버 예약: https://booking.naver.com/booking/6/bizes/123456");

    const draft = { blocks: [{ type: "text" as const, text: "본문" }] };
    const once = withPlaceInfo(draft, job({ research }));
    const twice = withPlaceInfo(once, job({ research }));
    expect(twice.blocks).toHaveLength(2);
    expect(twice.blocks[0]).toEqual({ type: "text", text: "본문" });
  });
  it("조사 결과가 없어도 지도 링크는 넣고, 제품 후기에는 붙이지 않는다", () => {
    const text = placeInfoBlock(job({}));
    expect(text?.type === "text" && text.text).toContain(MAP_SEARCH_URL + encodeURIComponent("비스타벨리 남양주"));
    expect(placeInfoBlock(job({ kind: "product", research }))).toBeUndefined();
  });
});

describe("이모지 분리(소제목 입력)", () => {
  it("이모지와 글자를 나누고, 확인용 글자에서는 이모지를 뺀다", () => {
    expect(splitEmoji("🌿 남양주 나들이")).toEqual(["🌿", " 남양주 나들이"]);
    expect(splitEmoji("🅿️ 주차 👨‍👩‍👧 가족")).toEqual(["🅿️", " 주차 ", "👨‍👩‍👧", " 가족"]);
    expect(splitEmoji("이모지 없음")).toEqual(["이모지 없음"]);
    expect(withoutEmoji("🗺️ 비스타밸리 둘러보기 & 안내 지도")).toBe("비스타밸리 둘러보기 & 안내 지도");
  });
});

describe("업로드 사진 크기", () => {
  it("본문 폭보다 좁은 사진은 최소 폭까지 키우고, 큰 사진은 그대로 줄이기만 한다", async () => {
    const small = await sharp({ create: { width: 340, height: 250, channels: 3, background: "#888" } }).jpeg().toBuffer();
    const up = await uploadCopy(small, 3000, 1000, 85);
    expect(up.info.width).toBe(1000);
    expect(up.info.height).toBe(735);
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#888" } }).jpeg().toBuffer();
    expect((await uploadCopy(big, 3000, 1000, 85)).info.width).toBe(3000);
    expect((await uploadCopy(small, 3000, 0, 85)).info.width).toBe(340);
  });
});
