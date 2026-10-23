import { describe, expect, it } from "vitest";

import type { MapBounds } from "./place-types";
import {
  followUpRequest,
  NEARBY_QUERY,
  nearbyRequest,
  newSearchRequest,
  nextPageRequest,
  regionRequest,
  shouldSendMapBounds,
} from "./search-request";

const bounds: MapBounds = {
  swLat: 37.49,
  swLng: 127.02,
  neLat: 37.51,
  neLng: 127.04,
};

describe("newSearchRequest", () => {
  it("앞뒤 공백을 뺀 입력만 담는다", () => {
    expect(newSearchRequest("  역삼 카페 ")).toEqual({ query: "역삼 카페" });
  });

  it("지도 영역을 받으면 mapBounds로 담는다", () => {
    expect(newSearchRequest("역삼 카페", bounds)).toEqual({
      query: "역삼 카페",
      mapBounds: bounds,
    });
  });
});

describe("followUpRequest", () => {
  it("기준 요청의 conditions를 previousConditions로 담는다", () => {
    const conditions = { quiet: true, nested: { a: null } };

    expect(followUpRequest("더 조용하게", { conditions })).toEqual({
      query: "더 조용하게",
      previousConditions: conditions,
    });
  });

  it("conditions가 빈 객체여도 그대로 보낸다", () => {
    expect(followUpRequest("더 조용하게", { conditions: {} })).toEqual({
      query: "더 조용하게",
      previousConditions: {},
    });
  });

  it("지도 영역을 받으면 함께 담는다", () => {
    expect(
      followUpRequest("더 조용하게", { conditions: {} }, bounds).mapBounds,
    ).toEqual(bounds);
  });
});

describe("nearbyRequest", () => {
  it("'근처'가 든 고정 문장만 담고 좌표도 지도 영역도 담지 않는다", () => {
    expect(nearbyRequest()).toEqual({ query: NEARBY_QUERY });
    expect(NEARBY_QUERY).toContain("근처");
  });
});

describe("nextPageRequest", () => {
  it("첫 요청을 그대로 다시 보내고 cursor만 더한다", () => {
    const first = {
      query: "더 조용하게",
      preferences: ["quiet"],
      previousConditions: { a: 1 },
      mapBounds: bounds,
    };

    expect(nextPageRequest(first, "MjA")).toEqual({ ...first, cursor: "MjA" });
  });
});

describe("regionRequest", () => {
  it("같은 query, preferences, previousConditions에 지도 영역을 담고 cursor는 뺀다", () => {
    const viewing = {
      query: "더 조용하게",
      preferences: ["quiet"],
      previousConditions: { a: 1 },
      cursor: "MjA",
    };

    expect(regionRequest(viewing, bounds)).toEqual({
      query: "더 조용하게",
      preferences: ["quiet"],
      previousConditions: { a: 1 },
      mapBounds: bounds,
    });
  });
});

describe("shouldSendMapBounds", () => {
  it("평소에는 지도 영역을 담지 않는다", () => {
    expect(
      shouldSendMapBounds({
        regionLocked: false,
        location: { status: "idle" },
      }),
    ).toBe(false);
    expect(
      shouldSendMapBounds({
        regionLocked: false,
        location: { status: "ok", here: { lat: 37.5, lng: 127.03 } },
      }),
    ).toBe(false);
  });

  it("'이 지역에서 검색'으로 지역을 고정했으면 담는다", () => {
    expect(
      shouldSendMapBounds({ regionLocked: true, location: { status: "idle" } }),
    ).toBe(true);
  });

  it("위치를 얻지 못한 것이 확인됐으면 담는다", () => {
    expect(
      shouldSendMapBounds({
        regionLocked: false,
        location: { status: "failed" },
      }),
    ).toBe(true);
  });
});
