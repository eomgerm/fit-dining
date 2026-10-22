// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";

import type { PlaceCard, PlaceDetail } from "../model/place-types";
import { createSearchStore, type SearchStore } from "../model/search-store";
import { PlaceDetailScreen } from "./place-detail-screen";

const params = vi.hoisted(() => ({ id: "1" as string | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams(params.id ? { id: params.id } : {}),
}));

const stores = vi.hoisted(() => ({
  current: undefined as unknown as SearchStore,
}));
vi.mock("../model/search-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model/search-store")>();
  return {
    ...actual,
    searchStore: new Proxy({} as SearchStore, {
      get: (_, key: keyof SearchStore) => stores.current[key],
    }),
  };
});

const place = {
  id: 1,
  name: "카페 온담",
  categoryGroup: "CAFE" as const,
  station: "YEOKSAM" as const,
  lat: 37.5,
  lng: 127.03,
};

const detail: PlaceDetail = {
  place,
  address: "서울 강남구 테헤란로 1",
  tags: ["조용한", "디저트"],
  photos: [],
  phone: "02-000-0000",
  openStatus: "OPEN",
  hours: (["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const).map(
    (dayOfWeek) => ({
      dayOfWeek,
      open: "10:00",
      close: "22:00",
      lastOrders: ["21:30"],
      closed: false,
    }),
  ),
  menus: [
    { category: "커피", name: "아메리카노", price: 4500 },
    { category: "디저트", name: "치즈케이크" },
  ],
  facilities: ["WIFI", "PARKING"],
};

const card: PlaceCard = {
  place,
  score: 84,
  labels: ["대화하기 좋은 곳", "자리가 넉넉한 곳"],
  caution: "주말 오후에는 대기가 길어요",
  openStatus: "OPEN",
  reasons: [
    {
      title: "조용히 대화하기 좋다는 리뷰가 많아요",
      tags: [{ source: "REQUEST", label: "조용해요" }],
      quote: "대화하기 좋아요",
      quoteSource: "앱 리뷰",
    },
  ],
  scoreItems: [
    { source: "REQUEST", label: "조용해요", matched: true, evidenceCount: 3 },
    { source: "PREFERENCE", label: "가성비", matched: false, evidenceCount: 0 },
  ],
};

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  params.id = "1";
  stores.current = createSearchStore();
  fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input) === "/api/v1/places/1"
      ? Response.json(detail)
      : Response.json({ status: 404 }, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDetail() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <PlaceDetailScreen />
    </QueryClientProvider>,
  );
}

describe("PlaceDetailScreen", () => {
  it("홈, 메뉴, 정보 탭을 보여 주고 리뷰 탭은 없다", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["홈", "메뉴", "정보"]);
    expect(screen.queryByText(/리뷰 \d/)).toBeNull();
  });

  it("검색 카드가 있으면 핏 점수, ⓘ 시트, AI 추천 이유, 주의점을 보여 준다", async () => {
    stores.current.recordCards([card]);
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    expect(screen.getByText("84")).toBeTruthy();
    expect(screen.queryByText("84%")).toBeNull();
    expect(screen.getByText("AI 추천 이유")).toBeTruthy();
    expect(
      screen.getByText("조용히 대화하기 좋다는 리뷰가 많아요"),
    ).toBeTruthy();
    expect(screen.getByText("주말 오후에는 대기가 길어요")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "핏 점수 설명" }));
    const sheet = await screen.findByRole("dialog", { name: "핏 점수 84" });
    expect(within(sheet).getByText("요청 · 조용해요")).toBeTruthy();
    expect(within(sheet).getByText("앱 리뷰 3개가 근거예요")).toBeTruthy();
    expect(within(sheet).getByText("내 취향 · 가성비")).toBeTruthy();
    expect(
      within(sheet).getByText("확인할 근거가 부족해서 점수에 넣지 않았어요"),
    ).toBeTruthy();
  });

  it("검색 카드가 없으면 핏 점수와 추천 이유를 숨기고 장소 정보만 보여 준다", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    expect(screen.queryByText("핏 점수")).toBeNull();
    expect(screen.queryByRole("button", { name: "핏 점수 설명" })).toBeNull();
    expect(screen.queryByText("AI 추천 이유")).toBeNull();
    expect(screen.queryByText("주말 오후에는 대기가 길어요")).toBeNull();
    expect(screen.getByText("서울 강남구 테헤란로 1")).toBeTruthy();
  });

  it("메뉴 탭은 카테고리별 메뉴와 가격을, 정보 탭은 시설을 보여 준다", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "메뉴" }));
    expect(await screen.findByRole("heading", { name: "커피" })).toBeTruthy();
    expect(screen.getAllByText("4,500원").length).toBeGreaterThan(0);
    expect(screen.getByText("정보가 실제와 다를 수 있어요")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "정보" }));
    expect(await screen.findByText("무선 인터넷")).toBeTruthy();
    expect(screen.getByText("주차")).toBeTruthy();
  });

  it.each(["0", "abc", "9007199254740992", null])(
    "?id=%s면 요청하지 않고 '장소를 찾을 수 없어요'를 보여 준다",
    async (id) => {
      params.id = id;
      renderDetail();

      expect(await screen.findByText("장소를 찾을 수 없어요")).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("모르는 장소면 '장소를 찾을 수 없어요'를 보여 준다", async () => {
    params.id = "999";
    renderDetail();

    expect(await screen.findByText("장소를 찾을 수 없어요")).toBeTruthy();
  });
});
