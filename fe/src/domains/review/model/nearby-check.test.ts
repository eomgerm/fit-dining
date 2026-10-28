import { describe, expect, it } from "vitest";

import { distanceMeters, isNearby } from "./nearby-check";

const place = { lat: 37.5, lng: 127.0 };

describe("distanceMeters", () => {
  it("위도 0.0009도는 약 100m다", () => {
    expect(distanceMeters(place, { lat: 37.5009, lng: 127.0 })).toBeCloseTo(
      100.08,
      1,
    );
  });
});

describe("isNearby", () => {
  it("측정 거리와 정확도를 더해 100m 이하면 근처다", () => {
    expect(isNearby(place, { ...place, accuracy: 100 })).toBe(true);
    expect(isNearby(place, { lat: 37.5008, lng: 127.0, accuracy: 10 })).toBe(
      true,
    );
  });

  it("더해서 100m를 넘으면 근처가 아니다", () => {
    expect(isNearby(place, { ...place, accuracy: 100.01 })).toBe(false);
    expect(isNearby(place, { lat: 37.5008, lng: 127.0, accuracy: 12 })).toBe(
      false,
    );
    expect(isNearby(place, { lat: 37.5009, lng: 127.0, accuracy: 0 })).toBe(
      false,
    );
  });

  it("장소 좌표를 모르면 근처가 아니다", () => {
    expect(isNearby({}, { ...place, accuracy: 5 })).toBe(false);
  });
});
