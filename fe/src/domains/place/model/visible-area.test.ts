import { describe, expect, it } from "vitest";

import { fitPlan, MIN_VISIBLE_FRACTION, visibleBand } from "./visible-area";

describe("visibleBand", () => {
  it("위 safe-area부터 아래 겹친 높이 위까지의 띠다", () => {
    expect(visibleBand({ height: 800, top: 40, bottomOverlap: 300 })).toEqual({
      top: 40,
      bottom: 500,
    });
    expect(visibleBand({ height: 400, top: 0, bottomOverlap: 0 })).toEqual({
      top: 0,
      bottom: 400,
    });
  });

  it("겹친 높이가 음수(겹치지 않음)면 0으로 본다", () => {
    expect(visibleBand({ height: 400, top: 0, bottomOverlap: -50 })).toEqual({
      top: 0,
      bottom: 400,
    });
  });

  it("띠가 0 이하이거나 지도 높이의 1/4 미만이면 없다(getBounds 전체로 대신한다)", () => {
    expect(MIN_VISIBLE_FRACTION).toBe(1 / 4);
    expect(visibleBand({ height: 800, top: 0, bottomOverlap: 601 })).toBe(
      undefined,
    );
    expect(visibleBand({ height: 800, top: 0, bottomOverlap: 600 })).toEqual({
      top: 0,
      bottom: 200,
    });
    expect(
      visibleBand({ height: 800, top: 50, bottomOverlap: 800 }),
    ).toBeUndefined();
    expect(
      visibleBand({ height: 0, top: 0, bottomOverlap: 0 }),
    ).toBeUndefined();
  });

  it("(property) 어떤 값이든 띠는 지도 안이고 1/4 규칙을 지킨다", () => {
    let state = 54;
    const next = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    for (let i = 0; i < 5000; i += 1) {
      const height = Math.floor(next() * 1200) - 100;
      const top = Math.floor(next() * 120) - 20;
      const bottomOverlap = Math.floor(next() * 1400) - 200;
      const band = visibleBand({ height, top, bottomOverlap });
      const expected = height - Math.max(bottomOverlap, 0) - Math.max(top, 0);
      if (expected <= 0 || expected < height * MIN_VISIBLE_FRACTION) {
        expect(band).toBeUndefined();
      } else {
        expect(band).toBeDefined();
        expect(band!.top).toBeGreaterThanOrEqual(0);
        expect(band!.bottom).toBeLessThanOrEqual(height);
        expect(band!.bottom - band!.top).toBe(expected);
      }
    }
  });
});

describe("fitPlan", () => {
  it("핀이 없으면 옮기지 않는다", () => {
    expect(fitPlan([])).toEqual({ kind: "none" });
  });

  it("1곳이면 그 핀으로 panTo다", () => {
    expect(fitPlan([{ lat: 37.5, lng: 127.03 }])).toEqual({
      kind: "pan",
      to: { lat: 37.5, lng: 127.03 },
    });
  });

  it("2곳 이상이면 위도·경도의 최솟값과 최댓값 사각형이다", () => {
    expect(
      fitPlan([
        { lat: 37.5, lng: 127.03 },
        { lat: 37.49, lng: 127.05 },
        { lat: 37.51, lng: 127.02 },
      ]),
    ).toEqual({
      kind: "fit",
      sw: { lat: 37.49, lng: 127.02 },
      ne: { lat: 37.51, lng: 127.05 },
    });
  });
});
