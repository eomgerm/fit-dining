import { describe, expect, it } from "vitest";

import {
  addRecentSearch,
  formatRecentAt,
  parseRecentSearches,
  RECENT_SEARCH_LIMIT,
  type RecentSearch,
} from "./recent-searches";

describe("addRecentSearch", () => {
  it("새 문장을 맨 위에 넣는다", () => {
    const list = [{ sentence: "역삼 카페", at: 1 }];

    expect(addRecentSearch(list, "강남 술집", 2)).toEqual([
      { sentence: "강남 술집", at: 2 },
      { sentence: "역삼 카페", at: 1 },
    ]);
  });

  it("앞뒤 공백을 뺀 문장이 같으면 하나만 남겨 맨 위로 올린다", () => {
    const list = [
      { sentence: "강남 술집", at: 2 },
      { sentence: "역삼 카페", at: 1 },
    ];

    expect(addRecentSearch(list, "  역삼 카페 ", 3)).toEqual([
      { sentence: "역삼 카페", at: 3 },
      { sentence: "강남 술집", at: 2 },
    ]);
  });

  it(`최대 ${RECENT_SEARCH_LIMIT}개를 넘으면 가장 오래된 것부터 버린다`, () => {
    const list: RecentSearch[] = Array.from(
      { length: RECENT_SEARCH_LIMIT },
      (_, index) => ({
        sentence: `문장 ${index}`,
        at: RECENT_SEARCH_LIMIT - index,
      }),
    );

    const next = addRecentSearch(list, "새 문장", 100);

    expect(next).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(next[0].sentence).toBe("새 문장");
    expect(next.at(-1)?.sentence).toBe(`문장 ${RECENT_SEARCH_LIMIT - 2}`);
  });

  it("공백뿐인 문장은 넣지 않는다", () => {
    const list = [{ sentence: "역삼 카페", at: 1 }];

    expect(addRecentSearch(list, "   ", 2)).toBe(list);
  });
});

describe("parseRecentSearches", () => {
  it("없거나 깨진 값은 빈 목록이다", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("{")).toEqual([]);
    expect(parseRecentSearches('{"sentence":"역삼"}')).toEqual([]);
  });

  it("형식이 틀린 줄은 버린다", () => {
    const raw = JSON.stringify([
      { sentence: "역삼 카페", at: 1 },
      { sentence: "", at: 2 },
      { sentence: "강남", at: "어제" },
      "문장",
    ]);

    expect(parseRecentSearches(raw)).toEqual([
      { sentence: "역삼 카페", at: 1 },
    ]);
  });
});

describe("formatRecentAt", () => {
  const now = new Date(2026, 9, 23, 18, 0).getTime();

  it("같은 날이면 '오늘'과 시각이다", () => {
    expect(formatRecentAt(new Date(2026, 9, 23, 14, 10).getTime(), now)).toBe(
      "오늘 오후 2:10",
    );
  });

  it("다른 날이면 월과 일이다", () => {
    expect(formatRecentAt(new Date(2026, 9, 14, 23, 59).getTime(), now)).toBe(
      "10월 14일",
    );
    expect(formatRecentAt(new Date(2025, 9, 23, 14, 10).getTime(), now)).toBe(
      "10월 23일",
    );
  });
});
