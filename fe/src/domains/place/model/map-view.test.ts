import { describe, expect, it } from "vitest";

import { DEFAULT_VIEW, parseMapView } from "./map-view";

// 시드를 고정한 의사 난수. 실패하면 같은 입력으로 다시 볼 수 있다
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

const SAMPLES = [
  0,
  -0,
  1,
  -1,
  6,
  21,
  5.9,
  21.1,
  15,
  37.5,
  127.03,
  90,
  -90,
  90.0001,
  180,
  -180,
  180.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "15",
  null,
  true,
  undefined,
  {},
  [],
];

describe("parseMapView", () => {
  it("저장된 지도 화면을 그대로 돌려준다", () => {
    expect(parseMapView('{"lat":36.3,"lng":127.4,"zoom":13}')).toEqual({
      lat: 36.3,
      lng: 127.4,
      zoom: 13,
    });
  });

  it("범위의 양 끝도 쓴다", () => {
    expect(parseMapView('{"lat":-90,"lng":180,"zoom":6}')).toEqual({
      lat: -90,
      lng: 180,
      zoom: 6,
    });
    expect(parseMapView('{"lat":90,"lng":-180,"zoom":21}')).toEqual({
      lat: 90,
      lng: -180,
      zoom: 21,
    });
  });

  it("세 값 밖의 키는 무시하고 세 값만 돌려준다", () => {
    expect(
      parseMapView('{"lat":37.5,"lng":127,"zoom":15,"here":{"lat":1}}'),
    ).toEqual({ lat: 37.5, lng: 127, zoom: 15 });
  });

  it.each([
    ["저장값 없음", null],
    ["JSON이 아님", "{lat:37"],
    ["배열", "[37.5,127,15]"],
    ["null", "null"],
    ["문자열", '"37.5,127,15"'],
    ["값 하나가 없음", '{"lat":37.5,"lng":127}'],
    ["숫자가 아님", '{"lat":"37.5","lng":127,"zoom":15}'],
    ["위도 범위 밖", '{"lat":90.01,"lng":127,"zoom":15}'],
    ["경도 범위 밖", '{"lat":37.5,"lng":-180.01,"zoom":15}'],
    ["확대 정도가 6보다 작음", '{"lat":37.5,"lng":127,"zoom":5}'],
    ["확대 정도가 21보다 큼", '{"lat":37.5,"lng":127,"zoom":22}'],
  ])("%s이면 값 전체를 무시한다", (_, raw) => {
    expect(parseMapView(raw)).toBeUndefined();
  });

  it("어떤 입력에도 던지지 않고, 돌려주는 값은 늘 범위 안의 유한한 세 숫자다", () => {
    const next = random(202);
    const pick = () => SAMPLES[Math.floor(next() * SAMPLES.length)];
    for (let i = 0; i < 2000; i += 1) {
      const candidate: Record<string, unknown> = {};
      for (const key of ["lat", "lng", "zoom", "extra"]) {
        if (next() < 0.85) candidate[key] = pick();
      }
      const raw =
        next() < 0.1
          ? JSON.stringify(candidate).slice(0, Math.floor(next() * 20))
          : JSON.stringify(candidate);

      const view = parseMapView(raw);

      if (view === undefined) continue;
      expect(Object.keys(view).sort()).toEqual(["lat", "lng", "zoom"]);
      expect(Number.isFinite(view.lat) && Math.abs(view.lat) <= 90).toBe(true);
      expect(Number.isFinite(view.lng) && Math.abs(view.lng) <= 180).toBe(true);
      expect(view.zoom >= 6 && view.zoom <= 21).toBe(true);
      // 저장값은 JSON을 거치므로(-0은 0이 된다) 기대값도 JSON을 거친 값이다
      const stored = JSON.parse(raw);
      expect(view).toEqual({
        lat: stored.lat,
        lng: stored.lng,
        zoom: stored.zoom,
      });
    }
  });

  it("기본 화면은 SSAFY 서울캠퍼스를 확대 정도 15로 본다", () => {
    expect(DEFAULT_VIEW).toEqual({ lat: 37.5013, lng: 127.0396, zoom: 15 });
  });
});
