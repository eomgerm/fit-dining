import { describe, expect, it } from "vitest";

import type { FormTag, ReviewFormResponse } from "./review";
import {
  canLeaveGoodPage,
  formatSpent,
  hasDetail,
  initialDraft,
  isDirty,
  normalizeSpent,
  reconcileDraft,
  toCreateRequest,
  type ReviewDraft,
} from "./review-draft";

const tag = (code: string, group: string): FormTag => ({
  code,
  label: code,
  group,
  displayGroup: "분위기",
});

function form(reviewedDates: string[] = []): ReviewFormResponse {
  return {
    place: { name: "카페 온담", categoryGroup: "CAFE", station: "YEOKSAM" },
    visitDate: { min: "2026-09-21", max: "2026-10-21", default: "2026-10-21" },
    reviewedDates,
    tags: {
      good: [tag("QUIET_GOOD", "NOISE")],
      bad: [tag("LIVELY_BAD", "NOISE")],
    },
    limits: { descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1_000_000 },
    writable: true,
  };
}

const empty = initialDraft(form());
const draft = (patch: Partial<ReviewDraft>) => ({ ...empty, ...patch });

describe("initialDraft", () => {
  it("방문일은 오늘이고 나머지는 비어 있다", () => {
    expect(empty).toEqual({
      visitedAt: "2026-10-21",
      tagCodes: [],
      revisitIntent: false,
      description: "",
      spentPerPerson: "",
    });
  });

  it("오늘 이미 쓴 장소면 방문일을 비워 둔다", () => {
    expect(initialDraft(form(["2026-10-21"])).visitedAt).toBeNull();
  });

  it("넘긴 방문일은 고를 수 있을 때만 쓰고, 아니면 원래 기본값이다", () => {
    expect(initialDraft(form(), "2026-10-14").visitedAt).toBe("2026-10-14");
    expect(initialDraft(form(), "2026-11-14").visitedAt).toBe("2026-10-21");
    expect(initialDraft(form(["2026-10-14"]), "2026-10-14").visitedAt).toBe(
      "2026-10-21",
    );
  });
});

describe("reconcileDraft", () => {
  const written = draft({
    visitedAt: "2026-09-21",
    tagCodes: ["QUIET_GOOD", "LIVELY_BAD"],
    revisitIntent: true,
    description: "좋았어요",
    spentPerPerson: "15000",
  });

  it("고를 수 있는 방문일과 노출되는 태그면 그대로 둔다", () => {
    expect(reconcileDraft(written, form())).toEqual(written);
  });

  it("다시 받은 범위 밖이거나 이미 쓴 날이면 방문일을 비우고 나머지 입력은 남긴다", () => {
    const nextDay = {
      ...form(),
      visitDate: {
        min: "2026-09-22",
        max: "2026-10-22",
        default: "2026-10-22",
      },
    };

    expect(reconcileDraft(written, nextDay)).toEqual({
      ...written,
      visitedAt: null,
    });
    expect(reconcileDraft(written, form(["2026-09-21"])).visitedAt).toBeNull();
  });

  it("더는 노출되지 않는 태그를 뺀다", () => {
    const withoutBad = { ...form(), tags: { ...form().tags, bad: [] } };

    expect(reconcileDraft(written, withoutBad).tagCodes).toEqual([
      "QUIET_GOOD",
    ]);
  });
});

describe("canLeaveGoodPage", () => {
  it("방문일과 좋았어요 태그가 있어야 7-01의 다음이 켜진다", () => {
    expect(canLeaveGoodPage(empty, form())).toBe(false);
    expect(canLeaveGoodPage(draft({ tagCodes: ["LIVELY_BAD"] }), form())).toBe(
      false,
    );
    expect(canLeaveGoodPage(draft({ tagCodes: ["QUIET_GOOD"] }), form())).toBe(
      true,
    );
    expect(
      canLeaveGoodPage(
        draft({ visitedAt: null, tagCodes: ["QUIET_GOOD"] }),
        form(),
      ),
    ).toBe(false);
  });
});

describe("hasDetail", () => {
  it("재방문 의사·본문·금액이 모두 비면 건너뛰기다", () => {
    expect(hasDetail(empty)).toBe(false);
    expect(hasDetail(draft({ description: "  \n" }))).toBe(false);
    expect(hasDetail(draft({ revisitIntent: true }))).toBe(true);
    expect(hasDetail(draft({ description: "좋았어요" }))).toBe(true);
    expect(hasDetail(draft({ spentPerPerson: "0" }))).toBe(true);
  });
});

describe("isDirty", () => {
  it("방문일을 바꾸거나 무엇이든 입력했으면 닫을 때 확인한다", () => {
    expect(isDirty(empty, empty)).toBe(false);
    expect(isDirty(draft({ visitedAt: "2026-10-20" }), empty)).toBe(true);
    expect(isDirty(draft({ tagCodes: ["QUIET_GOOD"] }), empty)).toBe(true);
    expect(isDirty(draft({ spentPerPerson: "12000" }), empty)).toBe(true);
  });
});

describe("normalizeSpent", () => {
  it("숫자만 남기고 앞의 0을 지운다", () => {
    expect(normalizeSpent("12,000", 1_000_000)).toBe("12000");
    expect(normalizeSpent("007", 1_000_000)).toBe("7");
    expect(normalizeSpent("0", 1_000_000)).toBe("0");
    expect(normalizeSpent("", 1_000_000)).toBe("");
    expect(normalizeSpent("abc", 1_000_000)).toBe("");
  });

  it("상한까지는 받고 넘으면 입력을 받지 않는다", () => {
    expect(normalizeSpent("1,000,000", 1_000_000)).toBe("1000000");
    expect(normalizeSpent("1,000,0001", 1_000_000)).toBeNull();
  });

  it("세 자리마다 쉼표를 찍어 보인다", () => {
    expect(formatSpent("1000000")).toBe("1,000,000");
    expect(formatSpent("")).toBe("");
  });
});

describe("toCreateRequest", () => {
  it("다 올린 사진이 있으면 그 id를 순서대로 보낸다", () => {
    expect(
      toCreateRequest(
        { ...draft({ tagCodes: ["QUIET_GOOD"] }), visitedAt: "2026-10-21" },
        ["b", "a"],
      ),
    ).toEqual({
      visitedAt: "2026-10-21",
      tagCodes: ["QUIET_GOOD"],
      revisitIntent: false,
      photos: ["b", "a"],
    });
  });

  it("빈 본문과 금액은 보내지 않는다", () => {
    expect(
      toCreateRequest({
        ...draft({ tagCodes: ["QUIET_GOOD"], description: " \n" }),
        visitedAt: "2026-10-21",
      }),
    ).toEqual({
      visitedAt: "2026-10-21",
      tagCodes: ["QUIET_GOOD"],
      revisitIntent: false,
    });
  });

  it("본문은 앞뒤 공백까지 그대로, 금액은 숫자로 보낸다", () => {
    expect(
      toCreateRequest({
        visitedAt: "2026-10-18",
        tagCodes: ["QUIET_GOOD", "LIVELY_BAD"],
        revisitIntent: true,
        description: " 좋았어요\n",
        spentPerPerson: "15000",
      }),
    ).toEqual({
      visitedAt: "2026-10-18",
      tagCodes: ["QUIET_GOOD", "LIVELY_BAD"],
      revisitIntent: true,
      description: " 좋았어요\n",
      spentPerPerson: 15000,
    });
  });
});
