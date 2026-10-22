// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";

import type { PlaceSuggestion } from "../model/place-types";
import { useSuggest } from "./use-suggest";

type PendingCall = {
  q: string;
  signal: AbortSignal;
  respond: (body: PlaceSuggestion[]) => void;
};

let calls: PendingCall[];

// 응답은 테스트가 respond로 직접 보낸다. 실제 fetch처럼 중단되면 reject하지만,
// 이미 서버를 떠난 응답이 늦게 오는 경우를 흉내 내려고 respond는 중단 뒤에도 부를 수 있다
function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      (input, init) =>
        new Promise((resolve, reject) => {
          const signal = init!.signal!;
          signal.addEventListener("abort", () => reject(signal.reason));
          calls.push({
            q: new URL(String(input), "http://localhost").searchParams.get(
              "q",
            )!,
            signal,
            respond: (body) => resolve(Response.json(body)),
          });
        }),
    ),
  );
}

const action: PlaceSuggestion = {
  type: "ACTION",
  label: "이 조건으로 추천받기",
};
const place = (name: string): PlaceSuggestion => ({
  type: "PLACE",
  place: {
    id: 1,
    name,
    categoryGroup: "RESTAURANT",
    station: "YEOKSAM",
    lat: 37.5,
    lng: 127.03,
  },
});

function renderSuggest(initial = "") {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(({ input }) => useSuggest(input), {
    wrapper,
    initialProps: { input: initial },
  });
}

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSuggest", () => {
  it("입력이 멈추고 300ms 뒤에 마지막 입력으로 한 번만 요청한다", async () => {
    const { rerender } = renderSuggest();

    rerender({ input: "역" });
    await wait(200);
    rerender({ input: "역삼" });
    await wait(200);
    rerender({ input: "역삼 쌀국수 " });
    await wait(299);
    expect(calls).toHaveLength(0);

    await wait(1);
    expect(calls.map(({ q }) => q)).toEqual(["역삼 쌀국수"]);
  });

  it("후보를 받으면 돌려준다", async () => {
    const { result, rerender } = renderSuggest();

    rerender({ input: "하노이" });
    await wait(300);
    calls[0].respond([place("하노이 쌀국수 역삼점"), action]);
    await wait(0);

    expect(result.current).toEqual([place("하노이 쌀국수 역삼점"), action]);
  });

  it("비었거나 공백뿐인 입력은 요청하지 않는다", async () => {
    const { result, rerender } = renderSuggest();

    rerender({ input: "   " });
    await wait(1000);

    expect(calls).toHaveLength(0);
    expect(result.current).toEqual([]);
  });

  it("새 요청을 보내면 이전 요청을 취소한다", async () => {
    const { rerender } = renderSuggest();
    rerender({ input: "역" });
    await wait(300);

    rerender({ input: "역삼" });
    await wait(300);

    expect(calls.map(({ q }) => q)).toEqual(["역", "역삼"]);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
  });

  it("입력이 비면 기다리지 않고 후보를 비우고 진행 중인 요청을 취소한다", async () => {
    const { result, rerender } = renderSuggest();
    rerender({ input: "역" });
    await wait(300);
    calls[0].respond([action]);
    await wait(0);
    expect(result.current).toEqual([action]);
    rerender({ input: "역삼" });
    await wait(300);
    expect(calls[1].signal.aborted).toBe(false);

    rerender({ input: " " });

    expect(result.current).toEqual([]);
    expect(calls[1].signal.aborted).toBe(true);
  });

  it("늦게 도착한 이전 요청의 응답은 쓰지 않는다", async () => {
    const { result, rerender } = renderSuggest();
    rerender({ input: "역" });
    await wait(300);
    rerender({ input: "역삼" });
    await wait(300);

    calls[0].respond([place("역 앞 오래된 후보"), action]);
    await wait(0);
    expect(result.current).toEqual([]);

    calls[1].respond([place("역삼 새 후보"), action]);
    await wait(0);
    expect(result.current).toEqual([place("역삼 새 후보"), action]);
  });

  it("입력을 지운 뒤 다시 쓰면 지우기 전 입력의 후보를 보여 주지 않는다", async () => {
    const { result, rerender } = renderSuggest();
    rerender({ input: "역" });
    await wait(300);
    calls[0].respond([place("역 후보")]);
    await wait(0);

    rerender({ input: "" });
    await wait(0);
    rerender({ input: "카" });

    expect(result.current).toEqual([]);
  });
});
