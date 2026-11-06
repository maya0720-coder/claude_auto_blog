/**
 * 얼굴 인식 보강: 인식 모델은 사진 전체를 작은 정사각형으로 줄여 보므로, 가로로 긴 사진이나
 * 멀리 있는 작은 얼굴을 놓칠 수 있다. 사진을 겹치는 조각으로 나눠 각각 찾고, 결과를 합친다.
 */
import type { FaceBox } from "./faces";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 0부터 total-size까지 size 크기 창을 stride 간격으로 놓는다(마지막 창은 끝에 맞춤). */
function positions(total: number, size: number, stride: number): number[] {
  if (size >= total) return [0];
  const out: number[] = [];
  for (let p = 0; p + size < total; p += stride) out.push(Math.round(p));
  out.push(total - size);
  return [...new Set(out)];
}

/**
 * 살펴볼 조각 목록: ① 사진 전체 ② 짧은 변 크기의 정사각형들(가로·세로로 긴 사진)
 * ③ 짧은 변의 60% 크기 격자(작은 얼굴용, 사진이 충분히 클 때). 조각끼리 겹치게 둔다.
 */
export function tileRects(w: number, h: number, minGridSide = 480): Rect[] {
  const rects: Rect[] = [{ left: 0, top: 0, width: w, height: h }];
  const s = Math.min(w, h);
  if (Math.max(w, h) / s > 1.2) {
    for (const x of positions(w, s, s / 2)) for (const y of positions(h, s, s / 2)) rects.push({ left: x, top: y, width: s, height: s });
  }
  const t = Math.round(s * 0.6);
  if (t >= minGridSide / 2 && s >= minGridSide) {
    const stride = t * 0.75;
    for (const x of positions(w, t, stride)) for (const y of positions(h, t, stride)) rects.push({ left: x, top: y, width: t, height: t });
  }
  return rects;
}

const area = (b: FaceBox) => b.width * b.height;

function overlap(a: FaceBox, b: FaceBox): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

/**
 * 여러 조각에서 찾은 같은 얼굴을 하나로 합친다: 점수 높은 것부터 남기고,
 * 이미 남긴 상자와 많이 겹치거나(IoU) 한쪽이 다른 쪽에 대부분 들어가면 버린다.
 */
export function mergeBoxes(boxes: FaceBox[], iou = 0.3, contain = 0.6): FaceBox[] {
  const kept: FaceBox[] = [];
  for (const b of [...boxes].sort((a, c) => c.score - a.score)) {
    const dup = kept.some((k) => {
      const inter = overlap(k, b);
      if (inter === 0) return false;
      return inter / (area(k) + area(b) - inter) > iou || inter / Math.min(area(k), area(b)) > contain;
    });
    if (!dup) kept.push(b);
  }
  return kept;
}
