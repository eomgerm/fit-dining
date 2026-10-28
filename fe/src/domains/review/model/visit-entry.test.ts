import { describe, expect, it } from "vitest";

import type { ReviewFormResponse } from "./review";
import { entryCheck, reviewedToday } from "./visit-entry";

function form(reviewedDates: string[] = []): ReviewFormResponse {
  return {
    place: {
      name: "카페 온담",
      categoryGroup: "CAFE",
      station: "YEOKSAM",
      lat: 37.5,
      lng: 127.0,
    },
    visitDate: { min: "2026-09-21", max: "2026-10-21", default: "2026-10-21" },
    reviewedDates,
    tags: { good: [], bad: [] },
    limits: { descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1000000 },
    writable: true,
  };
}

const here = { lat: 37.5, lng: 127.0, accuracy: 20 };

describe("reviewedToday", () => {
  it("방문일 상한(KST 오늘)에 이미 썼는지 본다", () => {
    expect(reviewedToday(form(["2026-10-21"]))).toBe(true);
    expect(reviewedToday(form(["2026-10-20"]))).toBe(false);
  });
});

describe("entryCheck", () => {
  it("오늘 이미 썼으면 근처여도 7-E01이다", () => {
    expect(entryCheck(form(["2026-10-21"]), here)).toBe("reviewedToday");
  });

  it("근처면 바로 작성 화면이다", () => {
    expect(entryCheck(form(), here)).toBe("nearby");
  });

  it("위치를 받지 못했거나 멀면 7-E02다", () => {
    expect(entryCheck(form(), null)).toBe("notNearby");
    expect(entryCheck(form(), { ...here, lat: 37.51 })).toBe("notNearby");
  });
});
