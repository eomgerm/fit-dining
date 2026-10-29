import { describe, expect, it } from "vitest";

import type { PlaceSearchResponse } from "./place-types";
import {
  appendTurn,
  formatRecentAt,
  mergeSummaries,
  parseThreads,
  sortThreads,
  summarizeThread,
  threadTitle,
  threadUpdatedAt,
  type SearchThread,
  type ThreadTurn,
} from "./search-threads";

const response: PlaceSearchResponse = {
  conditions: { area: "역삼" },
  nearby: false,
  totalCount: 30,
  items: [],
  nextCursor: "MjA",
};

function turn(id: string, at: number, query = "역삼 카페"): ThreadTurn {
  return { id, kind: "new", at, request: { query }, response };
}

describe("appendTurn", () => {
  it("thread가 없으면 새로 만들고, 있으면 끝에 쌓는다", () => {
    const first = appendTurn(undefined, "t1", turn("a", 1));
    const second = appendTurn(first, "t1", {
      ...turn("b", 2, "더 조용하게"),
      kind: "followUp",
      baseId: "a",
    });

    expect(second.id).toBe("t1");
    expect(second.turns.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(first.turns).toHaveLength(1);
  });

  it("다시 열 때 다음 페이지를 부르지 않도록 커서를 버린다", () => {
    const thread = appendTurn(undefined, "t1", turn("a", 1));

    expect(thread.turns[0].response).not.toHaveProperty("nextCursor");
    expect(thread.turns[0].response.totalCount).toBe(30);
  });
});

describe("thread 목록", () => {
  const older: SearchThread = { id: "old", turns: [turn("a", 1, "강남 술집")] };
  const newer: SearchThread = {
    id: "new",
    turns: [turn("b", 2, "역삼 카페"), turn("c", 5, "더 조용하게")],
  };

  it("이름은 첫 문장이고 시각은 마지막 요청 시각이다", () => {
    expect(threadTitle(newer)).toBe("역삼 카페");
    expect(threadUpdatedAt(newer)).toBe(5);
  });

  it("마지막 요청 시각 최신순으로 정렬한다", () => {
    expect(sortThreads([older, newer]).map(({ id }) => id)).toEqual([
      "new",
      "old",
    ]);
  });
});

describe("parseThreads", () => {
  it("없거나 깨진 값은 빈 목록이다", () => {
    expect(parseThreads(null)).toEqual([]);
    expect(parseThreads("{")).toEqual([]);
    expect(parseThreads('{"id":"t1"}')).toEqual([]);
  });

  it("형식이 틀린 thread는 버리고 나머지는 남긴다", () => {
    const good: SearchThread = { id: "t1", turns: [turn("a", 1)] };
    const raw = JSON.stringify([
      good,
      { id: "t2", turns: [] },
      { id: "t3", turns: [{ ...turn("b", 2), kind: "unknown" }] },
      { id: "t4", turns: [{ ...turn("c", 3), request: { query: "  " } }] },
      { id: "t5", turns: [{ ...turn("d", 4), response: { items: "x" } }] },
    ]);

    expect(parseThreads(raw)).toEqual([good]);
  });
});

// BE 기록 API가 받아 저장하는 turn은 parseThreads도 받아들인다(search-thread D-4). 방향은 "BE가 받으면 FE도 받는다"다
describe("parseThreads와 서버 thread", () => {
  const first = "entry-11111111-2222-3333-4444-555555555555";

  it("최소 필드, baseId 있는 followUp, 안쪽 null이 든 conditions를 그대로 받는다", () => {
    const thread = {
      id: "thread-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      turns: [
        {
          id: first,
          kind: "new",
          at: 0,
          request: { query: "q" },
          response: { items: [], totalCount: 0, conditions: {} },
        },
        {
          id: "entry-66666666-7777-8888-9999-000000000000",
          kind: "followUp",
          baseId: first,
          at: 8.64e15,
          request: {
            query: " 더 조용하게",
            previousConditions: { area: null, mood: {}, tags: [null] },
          },
          response: {
            items: [{ place: { id: 1 }, unknown: null }],
            totalCount: 1e21,
            conditions: { area: null, quiet: true, price: {} },
            changeSummary: null,
          },
        },
      ],
    };

    expect(parseThreads(JSON.stringify([thread]))).toEqual([thread]);
  });
});

describe("목록 요약", () => {
  it("요약은 thread id, 첫 질문, 마지막 요청 시각이다", () => {
    const thread: SearchThread = {
      id: "t1",
      turns: [turn("a", 5, "역삼 카페"), turn("b", 3, "더 조용하게")],
    };

    expect(summarizeThread(thread)).toEqual({
      id: "t1",
      title: "역삼 카페",
      lastAt: 3,
    });
  });

  it("페이지를 이으면 같은 id는 먼저 받은 것만 남긴다", () => {
    const a = { id: "a", title: "A", lastAt: 3 };
    const b = { id: "b", title: "B", lastAt: 2 };
    const movedA = { id: "a", title: "A", lastAt: 1 };

    expect(mergeSummaries([[a, b], [movedA, { ...b }], []])).toEqual([a, b]);
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
