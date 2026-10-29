import { describe, expect, it } from "vitest";

import {
  distanceMeters,
  filterNearby,
  formatDistance,
  NEARBY_PICK_LIMIT,
  pickNearby,
  YEOKSAM_STATION,
} from "./nearby";
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

  describe("pickNearby", () => {
    it(`반경 안의 항목을 순서대로 앞에서 ${NEARBY_PICK_LIMIT}곳까지 고른다`, () => {
      const far = cardAt(100, here.lat + 0.02, here.lng);
      const near = Array.from({ length: NEARBY_PICK_LIMIT + 2 }, (_, index) =>
        cardAt(index + 1, here.lat, here.lng),
      );

      const picked = pickNearby([far, ...near], here);

      expect(picked.map(({ place }) => place.id)).toEqual(
        near.slice(0, NEARBY_PICK_LIMIT).map(({ place }) => place.id),
      );
    });

    it("역삼역을 기준 지점으로 쓸 수 있다", () => {
      const station = cardAt(1, YEOKSAM_STATION.lat, YEOKSAM_STATION.lng);
      const gangnam = cardAt(2, 37.4979, 127.0276); // 역삼역에서 약 830m
      const seolleung = cardAt(3, 37.5045, 127.049); // 역삼역에서 약 1.2km

      expect(
        pickNearby([station, gangnam, seolleung], YEOKSAM_STATION),
      ).toEqual([station, gangnam]);
    });

    it("모든 카드에 점수가 없으면 반경 안에서 기준 지점에 가까운 순으로 고른다", () => {
      const withoutScore = (card: PlaceCard): PlaceCard => ({
        ...card,
        score: undefined,
      });
      const far = withoutScore(cardAt(1, here.lat + 0.008, here.lng)); // 약 890m
      const middle = withoutScore(cardAt(2, here.lat + 0.004, here.lng)); // 약 445m
      const near = withoutScore(cardAt(3, here.lat, here.lng));
      const outside = withoutScore(cardAt(4, here.lat + 0.02, here.lng));

      const picked = pickNearby([far, outside, middle, near], here);

      expect(picked.map(({ place }) => place.id)).toEqual([3, 2, 1]);
    });

    it("점수가 없어도 반경 안에서 앞 NEARBY_PICK_LIMIT곳까지만 고른다", () => {
      const cards = Array.from(
        { length: NEARBY_PICK_LIMIT + 2 },
        (_, index) => ({
          ...cardAt(index + 1, here.lat + 0.0005 * (index + 1), here.lng),
          score: undefined,
        }),
      ).reverse();

      const picked = pickNearby(cards, here);

      expect(picked.map(({ place }) => place.id)).toEqual(
        Array.from({ length: NEARBY_PICK_LIMIT }, (_, index) => index + 1),
      );
    });

    it("점수가 있는 카드가 있으면 서버 순서를 그대로 따른다", () => {
      const first = cardAt(1, here.lat + 0.008, here.lng);
      const second = cardAt(2, here.lat, here.lng);

      const picked = pickNearby([first, second], here);

      expect(picked.map(({ place }) => place.id)).toEqual([1, 2]);
    });
  });
});
