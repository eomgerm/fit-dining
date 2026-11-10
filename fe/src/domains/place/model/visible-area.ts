import type { LatLng } from "./place-types";

// 보이는 영역이 지도 높이의 이 비율보다 작으면 지도 전체 영역(getBounds)으로 대신한다.
// 임시값이고 실기기에서 다시 본다(spec Open questions, D-109)
export const MIN_VISIBLE_FRACTION = 1 / 4;

// 지도 안에서 사용자에게 보이는 가로 띠의 세로 범위(지도 위 끝 기준 px).
// 위는 safe-area만큼, 아래는 지도를 덮는 UI가 실제로 겹친 높이만큼 뺀다(spec 65번).
// 띠가 0 이하이거나 너무 작으면 없다
export function visibleBand({
  height,
  top,
  bottomOverlap,
}: {
  height: number;
  top: number;
  bottomOverlap: number;
}) {
  const start = Math.max(top, 0);
  const end = height - Math.max(bottomOverlap, 0);
  const size = end - start;
  if (size <= 0 || size < height * MIN_VISIBLE_FRACTION) return;
  return { top: start, bottom: end };
}

export type FitPlan =
  | { kind: "none" }
  | { kind: "pan"; to: LatLng }
  | { kind: "fit"; sw: LatLng; ne: LatLng };

// 결과 맞춤 이동(spec 69번). 0곳은 그대로, 1곳은 그 핀으로, 2곳 이상은 핀을 모두 담는 사각형으로
export function fitPlan(points: LatLng[]): FitPlan {
  if (points.length === 0) return { kind: "none" };
  if (points.length === 1) return { kind: "pan", to: points[0] };
  const lats = points.map(({ lat }) => lat);
  const lngs = points.map(({ lng }) => lng);
  return {
    kind: "fit",
    sw: { lat: Math.min(...lats), lng: Math.min(...lngs) },
    ne: { lat: Math.max(...lats), lng: Math.max(...lngs) },
  };
}
