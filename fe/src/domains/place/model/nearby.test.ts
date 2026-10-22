import { describe, expect, it } from "vitest";

import { distanceMeters, filterNearby, formatDistance } from "./nearby";
import type { PlaceCard } from "./place-types";

// 역삼역 근처. 위도 0.001도는 약 111m다
const here = { lat: 37.5, lng: 127.03 };

function cardAt(id: number, lat: number, lng: number): PlaceCard {
  return {
    place: {
      id,
      name: `장소 ${id}`,
      categoryGroup: "CAFE",
      station: "YEOKSAM",
      lat,
      lng,
    },
    score: 80,
    labels: ["조용해요", "넓어요"],
    openStatus: "OPEN",
    reasons: [],
    scoreItems: [],
  };
}

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

  describe("filterNearby", () => {
    it("반경 이하인 항목만 순서를 지켜 남긴다", () => {
      const near = cardAt(1, here.lat + 0.001, here.lng);
      const far = cardAt(2, here.lat + 0.02, here.lng);
      const alsoNear = cardAt(3, here.lat, here.lng);

      expect(filterNearby([near, far, alsoNear], here)).toEqual([
        near,
        alsoNear,
      ]);
    });

    it("반경과 같은 거리의 항목은 남긴다", () => {
      const card = cardAt(1, here.lat + 0.001, here.lng);
      const exact = distanceMeters(here, card.place);

      expect(filterNearby([card], here, exact)).toEqual([card]);
      expect(filterNearby([card], here, exact - 1)).toEqual([]);
    });

    it("기본 반경은 1000m다", () => {
      const inside = cardAt(1, here.lat + 0.0089, here.lng); // 약 990m
      const outside = cardAt(2, here.lat + 0.0091, here.lng); // 약 1012m

      expect(filterNearby([inside, outside], here)).toEqual([inside]);
    });
  });
});
