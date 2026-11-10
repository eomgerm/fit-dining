import { describe, expect, it } from "vitest";

import type { MapBounds } from "./place-types";
import {
  followUpRequest,
  isValidBounds,
  NEARBY_QUERY,
  nearbyRequest,
  newSearchRequest,
  nextPageRequest,
  regionRequest,
  runnableRequest,
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

  it("지금 지도가 아니라 기준 항목 요청의 mapBounds를 그대로 잇는다(AC-55)", () => {
    const base = {
      conditions: { area: "역삼" },
      request: { query: "역삼 카페", mapBounds: bounds },
    };

    expect(followUpRequest("더 조용하게", base)).toEqual({
      query: "더 조용하게",
      previousConditions: { area: "역삼" },
      mapBounds: bounds,
    });
  });

  it("기준이 '이 지역에서 검색' 항목이면 그 영역을 잇는다", () => {
    const base = {
      conditions: { menu: "파스타" },
      request: { query: "강남역 파스타", conditions: {}, mapBounds: bounds },
    };

    expect(followUpRequest("조용한 곳", base).mapBounds).toEqual(bounds);
  });

  it("기준에 영역이 없거나 기준이 실행 불가 기록(요청 없음)이면 담지 않는다", () => {
    expect(
      followUpRequest("더 조용하게", {
        conditions: {},
        request: { query: "역삼 카페" },
      }),
    ).not.toHaveProperty("mapBounds");
    expect(
      followUpRequest("더 조용하게", { conditions: {}, request: undefined }),
    ).not.toHaveProperty("mapBounds");
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
      previousConditions: { a: 1 },
      mapBounds: bounds,
    };

    expect(nextPageRequest(first, "MjA")).toEqual({ ...first, cursor: "MjA" });
  });

  it("region 요청도 본문 그대로 cursor만 더한다", () => {
    const first = { query: "역삼 카페", conditions: {}, mapBounds: bounds };

    expect(nextPageRequest(first, "MjA")).toEqual({ ...first, cursor: "MjA" });
  });
});

describe("regionRequest", () => {
  it("보던 항목의 문장과 응답 conditions, 지도 영역을 담고 previousConditions는 없다", () => {
    const viewing = {
      sentence: "더 조용하게",
      conditions: { quiet: true },
      request: {
        query: "더 조용하게",
        previousConditions: { a: 1 },
        cursor: "MjA",
      },
    };

    expect(regionRequest(viewing, bounds)).toEqual({
      query: "더 조용하게",
      conditions: { quiet: true },
      mapBounds: bounds,
    });
  });

  it("conditions가 빈 객체여도 보낸다", () => {
    expect(
      regionRequest({ sentence: "역삼 카페", conditions: {} }, bounds),
    ).toEqual({ query: "역삼 카페", conditions: {}, mapBounds: bounds });
  });
});

describe("isValidBounds", () => {
  it("네 값이 유한하고 범위 안이며 sw < ne일 때만 맞다(경계값 포함)", () => {
    expect(isValidBounds(bounds)).toBe(true);
    expect(
      isValidBounds({ swLat: -90, swLng: -180, neLat: 90, neLng: 180 }),
    ).toBe(true);
  });

  it.each([
    ["없음", undefined],
    ["null", null],
    ["배열", [1, 2, 3, 4]],
    ["값 하나 빠짐", { swLat: 37.49, swLng: 127.02, neLat: 37.51 }],
    ["null 값", { ...bounds, neLng: null }],
    ["문자열 값", { ...bounds, swLat: "37.49" }],
    ["NaN", { ...bounds, swLat: Number.NaN }],
    ["무한대", { ...bounds, neLat: Number.POSITIVE_INFINITY }],
    ["위도 범위 밖", { ...bounds, neLat: 90.0001 }],
    ["경도 범위 밖", { ...bounds, swLng: -180.0001 }],
    ["sw == ne 위도", { ...bounds, neLat: bounds.swLat }],
    ["sw > ne 경도", { ...bounds, swLng: 127.05 }],
    ["sw == ne 경도", { ...bounds, neLng: bounds.swLng }],
  ])("%s이면 틀리다", (_, value) => {
    expect(isValidBounds(value)).toBe(false);
  });
});

const response = (conditions: Record<string, unknown> = { area: "역삼" }) => ({
  conditions,
});

describe("runnableRequest", () => {
  it("new·followUp 기록은 저장된 본문 그대로다", () => {
    expect(
      runnableRequest({
        kind: "followUp",
        request: {
          query: "더 조용하게",
          previousConditions: { a: 1 },
          mapBounds: bounds,
        },
        response: response(),
      }),
    ).toEqual({
      query: "더 조용하게",
      previousConditions: { a: 1 },
      mapBounds: bounds,
    });
    expect(
      runnableRequest({
        kind: "new",
        request: { query: "역삼 카페" },
        response: response(),
      }),
    ).toEqual({ query: "역삼 카페" });
  });

  it("new·followUp 기록은 아는 필드만 옮긴다(모르는 키, 객체 아닌 조건, 유한하지 않은 영역은 버린다)", () => {
    expect(
      runnableRequest({
        kind: "new",
        request: {
          query: "역삼 카페",
          lat: 37.5,
          cursor: "MjA",
          previousConditions: [1, 2],
          mapBounds: { ...bounds, extra: 1 },
        },
        response: response(),
      }),
    ).toEqual({ query: "역삼 카페", mapBounds: bounds });
    expect(
      runnableRequest({
        kind: "new",
        request: { query: "역삼 카페", mapBounds: { ...bounds, swLat: "1" } },
        response: response(),
      }),
    ).toEqual({ query: "역삼 카페" });
  });

  it("새 모양 region 기록은 저장된 query, conditions, mapBounds다", () => {
    expect(
      runnableRequest({
        kind: "region",
        request: {
          query: "역삼 카페",
          conditions: { a: 1 },
          mapBounds: bounds,
        },
        response: response(),
      }),
    ).toEqual({ query: "역삼 카페", conditions: { a: 1 }, mapBounds: bounds });
  });

  it("옛 모양 region 기록은 previousConditions 없이 응답 conditions를 보낸다(빈 객체여도)", () => {
    expect(
      runnableRequest({
        kind: "region",
        request: {
          query: "강남역 파스타",
          previousConditions: { area: "강남역" },
          mapBounds: bounds,
        },
        response: response({}),
      }),
    ).toEqual({ query: "강남역 파스타", conditions: {}, mapBounds: bounds });
  });

  it("region 기록의 conditions가 null이거나 객체가 아니면 응답 conditions를 쓰고, 영역은 네 값만 옮긴다", () => {
    for (const conditions of [null, [1], "x", 3]) {
      expect(
        runnableRequest({
          kind: "region",
          request: {
            query: "역삼 카페",
            conditions,
            mapBounds: { ...bounds, zoom: 15 },
          },
          response: response(),
        }),
      ).toEqual({
        query: "역삼 카페",
        conditions: { area: "역삼" },
        mapBounds: bounds,
      });
    }
  });

  it("region 기록의 영역이 없거나 규칙에 어긋나면 실행 불가다", () => {
    for (const mapBounds of [
      undefined,
      { ...bounds, neLat: bounds.swLat },
      { swLat: 1 },
    ]) {
      expect(
        runnableRequest({
          kind: "region",
          request: { query: "역삼 카페", mapBounds },
          response: response(),
        }),
      ).toBeUndefined();
    }
  });
});

// 시드를 고정한 난수(map-view.test.ts와 같은 방식)
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("runnableRequest (property)", () => {
  it("어떤 저장 기록이든 던지지 않고, region이면 previousConditions가 없으며 영역이 규칙에 맞을 때만 실행 가능이고, 어떤 본문에도 기기 좌표 필드가 없다(AC-16, AC-63)", () => {
    const next = random(203);
    const pick = <T>(values: T[]) => values[Math.floor(next() * values.length)];
    const number = () =>
      pick([
        0,
        37.5,
        127.03,
        -90,
        90,
        -180,
        180,
        91,
        -181,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        (next() - 0.5) * 400,
      ]);
    const value = (): unknown =>
      pick([
        undefined,
        null,
        {},
        { area: "역삼" },
        [],
        "x",
        3,
        { swLat: number(), swLng: number(), neLat: number(), neLng: number() },
        {
          swLat: number(),
          swLng: number(),
          neLat: number(),
          neLng: number(),
          lat: 37.5,
        },
      ]);

    for (let i = 0; i < 3000; i += 1) {
      const kind = pick(["new", "followUp", "region"] as const);
      const request: Record<string, unknown> = { query: "역삼 카페" };
      for (const key of [
        "previousConditions",
        "conditions",
        "mapBounds",
        "cursor",
        "lat",
        "lng",
      ]) {
        const v = value();
        if (v !== undefined) request[key] = v;
      }
      const conditions = pick([{}, { area: "역삼" }]);

      const result = runnableRequest({
        kind,
        request: request as { query: string },
        response: { conditions },
      });

      // conditions·previousConditions 안쪽은 불투명한 값이라 보지 않는다. 본문과 영역의 키만 본다
      if (result) {
        for (const key of Object.keys(result)) {
          expect([
            "query",
            "previousConditions",
            "conditions",
            "mapBounds",
          ]).toContain(key);
        }
        if (result.mapBounds) {
          expect(Object.keys(result.mapBounds).sort()).toEqual([
            "neLat",
            "neLng",
            "swLat",
            "swLng",
          ]);
        }
      }
      if (kind === "region") {
        expect(result === undefined).toBe(!isValidBounds(request.mapBounds));
        if (result) {
          expect(result).not.toHaveProperty("previousConditions");
          expect(result).toHaveProperty("conditions");
        }
      } else {
        expect(result).toBeDefined();
        expect(result).not.toHaveProperty("conditions");
      }
    }
  });
});
