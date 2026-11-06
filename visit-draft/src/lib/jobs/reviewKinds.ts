/**
 * 후기 종류(장소 방문 / 제품 사용)별 문구. 화면 입력 칸과 AI 요청 문구가 같은 이름을 쓰도록 한곳에 둔다.
 * 메모 필드는 저장 구조를 바꾸지 않고(예전 작업 호환) 종류에 따라 이름만 달리 붙인다.
 * 서버·화면 공용이므로 Node 모듈을 가져오지 않는다.
 */
import type { ReviewKind, VisitMemo } from "./types";

type MemoTextKey = Exclude<keyof VisitMemo, "rating">;

export interface MemoFieldText {
  key: MemoTextKey;
  label: string;
  placeholder: string;
  max: number;
  multiline?: boolean;
}

export interface KindText {
  label: string;
  short: string;
  description: string;
  subject: { title: string; name: string; namePlaceholder: string; area: string; areaPlaceholder: string; link: string; linkPlaceholder: string };
  researchHint: string;
  memoTitle: string;
  memoHint: string;
  memo: MemoFieldText[];
  researchStep: { title: string; waiting: string };
}

export const KIND_TEXT: Record<ReviewKind, KindText> = {
  place: {
    label: "장소 방문 후기",
    short: "장소",
    description: "맛집·카페·여행지·체험 공간",
    subject: {
      title: "다녀온 장소",
      name: "장소 이름",
      namePlaceholder: "예: 성수동 OO카페",
      area: "지역",
      areaPlaceholder: "예: 서울 성동구",
      link: "장소 링크",
      linkPlaceholder: "네이버 지도·홈페이지 주소",
    },
    researchHint: "AI가 웹에서 주소·영업시간·메뉴 등 사실 정보를 찾고 출처를 함께 보여 드립니다.",
    memoTitle: "방문 메모",
    memoHint: "맛·친절·분위기 같은 경험은 여기 적은 내용만 글에 들어갑니다.",
    memo: [
      { key: "visitedOn", label: "방문일", placeholder: "사진 촬영일로 자동 채움", max: 20 },
      { key: "companions", label: "함께 간 사람", placeholder: "예: 친구 2명", max: 100 },
      { key: "ordered", label: "주문·이용한 것", placeholder: "예: 트러플 파스타, 아메리카노", max: 500, multiline: true },
      { key: "good", label: "좋았던 점", placeholder: "예: 창가 뷰가 좋았어요", max: 1000, multiline: true },
      { key: "bad", label: "아쉬웠던 점", placeholder: "예: 주말이라 20분 대기", max: 1000, multiline: true },
      { key: "free", label: "그 밖에 쓰고 싶은 말", placeholder: "자유롭게", max: 2000, multiline: true },
    ],
    researchStep: { title: "장소 정보 조사", waiting: "웹에서 영업시간·메뉴·주차 등을 찾습니다" },
  },
  product: {
    label: "제품 사용 후기",
    short: "제품",
    description: "제품 홍보·체험단·구매 후기",
    subject: {
      title: "후기 쓸 제품",
      name: "제품 이름",
      namePlaceholder: "예: OO 무선 청소기 V12",
      area: "브랜드",
      areaPlaceholder: "예: OO전자",
      link: "제품 링크",
      linkPlaceholder: "공식몰·스마트스토어 주소",
    },
    researchHint: "AI가 웹에서 사양·가격·구성품 등 사실 정보를 찾고 출처를 함께 보여 드립니다.",
    memoTitle: "사용 메모",
    memoHint: "성능·만족도 같은 경험은 여기 적은 내용만 글에 들어갑니다.",
    memo: [
      { key: "visitedOn", label: "사용 기간", placeholder: "예: 2주 사용", max: 20 },
      { key: "companions", label: "사용 환경·대상", placeholder: "예: 30평 아파트, 반려견", max: 100 },
      { key: "ordered", label: "구매·제공 옵션", placeholder: "예: 화이트, 256GB, 체험단 제공", max: 500, multiline: true },
      { key: "good", label: "좋았던 점", placeholder: "예: 흡입력이 세고 가벼워요", max: 1000, multiline: true },
      { key: "bad", label: "아쉬웠던 점", placeholder: "예: 먼지통이 작아요", max: 1000, multiline: true },
      { key: "free", label: "그 밖에 쓰고 싶은 말", placeholder: "강조할 기능, 추천 대상 등", max: 2000, multiline: true },
    ],
    researchStep: { title: "제품 정보 조사", waiting: "웹에서 사양·가격·구성품 등을 찾습니다" },
  },
};

/** AI 요청에 넣을 메모 줄(종류에 맞는 이름으로). 빈 값은 뺀다 */
export function memoLines(kind: ReviewKind, memo: VisitMemo): string[] {
  const lines = KIND_TEXT[kind].memo.flatMap((f) => (memo[f.key] ? [`${f.label}: ${memo[f.key]}`] : []));
  if (memo.rating) lines.push(`별점: ${memo.rating}/5`);
  return lines;
}
