/** 화면 문구: 단계 이름, 상태 이름 */
import { GENERATE_STEPS, SAVE_STEPS, type JobStatus } from "../jobs/types";
import type { RunKind } from "../runs/types";

export const STEP_LABELS: Record<string, { title: string; waiting: string }> = {
  photos: { title: "사진 준비", waiting: "얼굴을 찾아 가리고, 위치 정보를 지운 사본을 만듭니다" },
  analyze: { title: "AI 사진 분석", waiting: "사진마다 무엇이 찍혔는지 파악하고 설명 초안을 만듭니다" },
  style: { title: "문체·템플릿 분석", waiting: "내 블로그(또는 참고 블로그) 글을 읽어 구성과 말투를 파악합니다" },
  research: { title: "정보 조사", waiting: "웹에서 장소·제품의 사실 정보를 찾고 출처를 모읍니다" },
  write: { title: "후기 원고 작성", waiting: "사진을 보고 글을 쓰고, 사진 자리와 설명을 정합니다" },
  login: { title: "네이버 로그인 확인", waiting: "로그인 상태를 확인합니다" },
  editor: { title: "글쓰기 화면 열기", waiting: "네이버 블로그 글쓰기 화면을 엽니다" },
  content: { title: "제목·본문·사진 입력", waiting: "원고와 사진을 순서대로 넣습니다" },
  save: { title: "임시저장", waiting: "'저장' 버튼만 누릅니다(발행하지 않음)" },
};

export const stepsFor = (kind: RunKind) => (kind === "generate" ? GENERATE_STEPS : SAVE_STEPS);

export const STATUS_LABELS: Record<JobStatus, string> = {
  processing: "만드는 중",
  draft_ready: "원고 완성",
  saving: "저장 중",
  saved: "임시저장됨",
  failed: "실패",
};

export const FACE_MODE_LABELS = { mosaic: "모자이크", sticker: "귀여운 스티커", none: "가리지 않음" } as const;
export const LENGTH_LABELS = { normal: "중간 글 · 1,500~2,000자", long: "긴 글 · 3,000자 이상" } as const;
