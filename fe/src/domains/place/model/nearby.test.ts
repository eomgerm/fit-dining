import { describe, expect, it } from "vitest";

import { distanceMeters, formatDistance } from "./nearby";

// 역삼역 근처. 위도 0.001도는 약 111m다
const here = { lat: 37.5, lng: 127.03 };

describe("nearby", () => {
  describe("distanceMeters", () => {
    it("같은 지점은 0m다", () => {
      expect(distanceMeters(here, here)).toBe(0);
    });

    it("haversine(지구 반지름 6,371,000m)으로 계산한다", () => {
      // 위도 1도 = 6371000 * π / 180 ≈ 111195m
      expect(
        distanceMeters({ lat: 37, lng: 127 }, { lat: 38, lng: 127 }),
      ).toBeCloseTo(111_195, 0);
    });
  });

  describe("formatDistance", () => {
    it.each([
      [0, "0m"],
      [344, "340m"],
      [345, "350m"],
      [994, "990m"],
      [995, "1.0km"],
      [1000, "1.0km"],
      [1234, "1.2km"],
      [12_340, "12.3km"],
    ])("%dm는 %s로 보인다", (meters, text) => {
      expect(formatDistance(meters)).toBe(text);
    });
  });
});
