/**
 * 스마트에디터에 글자를 넣을 때 이모지와 일반 글자를 나눠 넣기 위한 분리기.
 * 실제 저장 결과에서 "🌿 소제목" 같은 줄이 이모지만 남고 뒤 글자가 사라졌다.
 * 에디터가 이모지가 섞인 한 번의 입력을 특별 처리하며 나머지를 버리는 것으로 보여, 조각별로 따로 넣는다.
 */

/** 이모지 한 덩어리(변형 선택자·피부색·ZWJ 결합·국기 포함) */
const EMOJI_RE = /((?:\p{Regional_Indicator}{2})|(?:\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?)*)|[#*0-9]️?⃣)/u;

/** 줄을 이모지 조각과 일반 글자 조각으로 나눈다. 빈 조각은 버린다 */
export function splitEmoji(line: string): string[] {
  return line.split(EMOJI_RE).filter((s) => s !== "" && s !== undefined);
}

export function hasEmoji(line: string): boolean {
  return EMOJI_RE.test(line);
}

/** 이모지를 뺀 글자(입력 확인용). 앞뒤 공백 정리 */
export function withoutEmoji(line: string): string {
  return splitEmoji(line)
    .filter((s) => !EMOJI_RE.test(s) && !/^[️‍]+$/.test(s))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
