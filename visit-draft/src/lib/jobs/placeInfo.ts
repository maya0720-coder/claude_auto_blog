/**
 * 장소 후기 끝에 붙이는 "방문 정보" 블록(주소·운영시간·주차 + 네이버 지도·예약 링크)을 코드로 만든다.
 * AI가 아닌 코드로 만드는 이유: 링크 주소를 AI가 지어내지 않게 하고, 형식을 항상 같게 하려고.
 * - 네이버 지도: 사용자가 준 네이버 지도/플레이스 링크 → 없으면 "정식 이름 + 지역"으로 지도 검색 링크(항상 유효)
 * - 네이버 예약: 조사에서 찾은 booking.naver.com 주소가 형식에 맞을 때만(화면에서 확인하도록 안내)
 * 서버·화면 공용이라 Node 모듈을 쓰지 않는다.
 */
import type { DraftBlock, Job, PlaceResearch } from "./types";

/** 사용자가 준 링크 중 네이버 지도·플레이스로 볼 수 있는 주소 */
const NAVER_MAP_HOSTS = ["naver.me", "map.naver.com", "m.map.naver.com", "place.naver.com", "m.place.naver.com", "pcmap.place.naver.com"];
/** 네이버 예약 상세 주소 형식(업체 번호까지 있는 것만) */
const BOOKING_RE = /^https:\/\/(m\.)?booking\.naver\.com\/booking\/\d{1,3}\/bizes\/\d{1,12}(\/items\/\d{1,12})?\/?(\?[^\s]*)?$/;

export const MAP_SEARCH_URL = "https://map.naver.com/p/search/";
/** 방문 정보 블록 첫 줄(이미 붙어 있는지 찾는 데도 쓴다) */
export const PLACE_INFO_HEADER = "📍 방문 정보";

export function isNaverMapUrl(u: string | undefined): u is string {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && NAVER_MAP_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

export function isNaverBookingUrl(u: string | undefined): u is string {
  return !!u && BOOKING_RE.test(u);
}

/** 조사 결과에서 라벨이 맞는 첫 사실 값. "(출처마다 다름)" 같은 조사용 메모는 글에 넣지 않는다 */
function factValue(research: PlaceResearch | undefined, re: RegExp): string | undefined {
  const f = research?.facts.find((x) => re.test(x.label));
  const v = f?.value.replace(/\s*\(?출처마다 다름\)?/g, "").trim();
  return v || undefined;
}

export interface PlaceLinks {
  map: string;
  /** 사용자가 준 링크면 true, 지도 검색 링크면 false */
  mapFromUser: boolean;
  booking?: string;
}

export function placeLinks(job: Pick<Job, "input" | "research">): PlaceLinks {
  const user = job.input.place.link;
  if (isNaverMapUrl(user)) return withBooking({ map: user, mapFromUser: true }, job.research);
  const name = factValue(job.research, /상호|이름/) ?? job.input.place.name;
  const area = job.input.place.area ?? factValue(job.research, /주소/)?.split(/\s+/).slice(0, 2).join(" ");
  const query = [name, area].filter(Boolean).join(" ").slice(0, 80);
  return withBooking({ map: MAP_SEARCH_URL + encodeURIComponent(query), mapFromUser: false }, job.research);
}

function withBooking(links: PlaceLinks, research: PlaceResearch | undefined): PlaceLinks {
  const b = research?.links?.naverBooking;
  return isNaverBookingUrl(b) ? { ...links, booking: b } : links;
}

/** 장소 후기의 방문 정보 블록. 제품 후기면 undefined */
export function placeInfoBlock(job: Pick<Job, "input" | "research">): DraftBlock | undefined {
  if (job.input.kind !== "place") return undefined;
  const links = placeLinks(job);
  const lines = [
    PLACE_INFO_HEADER,
    `${factValue(job.research, /상호|이름/) ?? job.input.place.name}`,
    ...([
      ["주소", factValue(job.research, /주소/)],
      ["운영시간", factValue(job.research, /영업|운영|이용\s*시간/)],
      ["휴무", factValue(job.research, /휴무/)],
      ["주차", factValue(job.research, /주차/)],
    ] as const).flatMap(([k, v]) => (v ? [`· ${k}: ${v}`] : [])),
    `🗺️ 네이버 지도: ${links.map}`,
    ...(links.booking ? [`📅 네이버 예약: ${links.booking}`] : []),
  ];
  return { type: "text", text: lines.join("\n").slice(0, 3000) };
}

/** 원고 끝(같은 블록이 이미 있으면 교체)에 방문 정보를 붙인다 */
export function withPlaceInfo<T extends { blocks: DraftBlock[] }>(draft: T, job: Pick<Job, "input" | "research">): T {
  const block = placeInfoBlock(job);
  if (!block) return draft;
  const rest = draft.blocks.filter((b) => !(b.type === "text" && b.text.startsWith(PLACE_INFO_HEADER)));
  return { ...draft, blocks: [...rest, block] };
}
