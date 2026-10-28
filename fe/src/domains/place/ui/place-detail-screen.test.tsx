// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import type { RuntimeConfig } from "@/shared/lib/runtime-config";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import type { PlaceCard, PlaceDetail } from "../model/place-types";
import { createSearchStore, type SearchStore } from "../model/search-store";
import {
  PlaceDetailScreen,
  type PlaceDetailSlots,
} from "./place-detail-screen";

const params = vi.hoisted(() => ({ id: "1" as string | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams(params.id ? { id: params.id } : {}),
}));

// 정보 탭 위치 지도가 지도 키를 읽는다. 기본은 키가 없어 지도 자리가 접힌다
const config = vi.hoisted(() => ({
  value: undefined as RuntimeConfig | undefined,
  load: vi.fn(),
}));
vi.mock("@/shared/lib/runtime-config", () => ({
  loadRuntimeConfig: async () => {
    config.load();
    return config.value;
  },
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
  config.load.mockClear();
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

function renderDetail(slots?: PlaceDetailSlots) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <PlaceDetailScreen slots={slots} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// 리뷰 도메인 대신 자리만 확인하는 가짜 내용. 실제로는 app/place가 리뷰 컴포넌트로 채운다
const reviewSlots: PlaceDetailSlots = {
  homeReviews: (placeId, showReviews) => (
    <button type="button" onClick={showReviews}>
      리뷰 미리보기 {placeId}
    </button>
  ),
  reviewTab: (placeId) => <p>리뷰 목록 {placeId}</p>,
  bottomAction: (placeId) => (
    <a href={`/write?id=${placeId}`}>방문 평가 남기기</a>
  ),
};

describe("PlaceDetailScreen", () => {
  it("리뷰 자리를 넘기지 않으면 홈, 메뉴, 정보 탭만 있고 하단 막대에는 저장 버튼만 있다", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["홈", "메뉴", "정보"]);
    expect(screen.getByRole("button", { name: "저장" })).toBeTruthy();
    expect(screen.queryByText("방문 평가 남기기")).toBeNull();
  });

  it("리뷰 자리를 넘기면 리뷰 탭, 홈 미리보기, 하단 버튼이 생기고 미리보기에서 리뷰 탭을 연다", async () => {
    renderDetail(reviewSlots);

    await screen.findByRole("heading", { name: "카페 온담" });
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["홈", "메뉴", "리뷰", "정보"]);
    expect(screen.getByRole("link", { name: "방문 평가 남기기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "리뷰 미리보기 1" }));
    expect(
      screen.getByRole("tab", { name: "리뷰" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      within(screen.getByRole("tabpanel")).getByText("리뷰 목록 1"),
    ).toBeTruthy();
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
    // 점수에 넣지 못한 항목의 근거 부족 안내
    expect(
      screen.getByText("이 장소는 ‘가성비’ 취향을 확인할 근거가 부족해요"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "핏 점수 84, 설명 보기" }),
    );
    const tip = await screen.findByRole("dialog", { name: "핏 점수 설명" });
    expect(within(tip).getByText(/0~100으로 나타낸 점수예요/)).toBeTruthy();
  });

  it("검색 카드가 없으면 핏 점수와 추천 이유를 숨기고 장소 정보만 보여 준다", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    expect(screen.queryByText("핏 점수")).toBeNull();
    expect(screen.queryByRole("button", { name: /핏 점수/ })).toBeNull();
    expect(screen.queryByText(/근거가 부족해요/)).toBeNull();
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
    // 오늘 줄은 "<요일> · 오늘", 라스트오더는 줄을 덧붙인다
    expect(screen.getByRole("rowheader", { name: / · 오늘$/ })).toBeTruthy();
    expect(screen.getAllByText("21:30 라스트오더")).toHaveLength(7);
    expect(screen.getAllByText("10:00 – 22:00")).toHaveLength(7);
  });

  it("홈 탭의 영업시간 줄은 오늘 시간이고 펼치면 요일별 표가 나온다", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    const row = screen.getByRole("button", { name: "요일별 영업시간 보기" });
    expect(row.textContent).toContain("오늘 10:00 – 22:00");
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(row);
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it.each(["공유", "저장"])(
    "'%s' 버튼은 '준비 중이에요'를 띄운다",
    async (name) => {
      renderDetail();
      await screen.findByRole("heading", { name: "카페 온담" });

      fireEvent.click(screen.getByRole("button", { name }));

      expect(await screen.findByText("준비 중이에요")).toBeTruthy();
    },
  );

  it("정보 탭의 '주소 복사'는 주소를 클립보드에 넣고 알린다", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "정보" }));
    fireEvent.click(await screen.findByRole("button", { name: "주소 복사" }));

    expect(writeText).toHaveBeenCalledWith("서울 강남구 테헤란로 1");
    expect(await screen.findByText("주소를 복사했어요")).toBeTruthy();
  });

  it("위치 지도는 정보 탭을 열 때만 만들고, 지도 키가 없으면 자리를 차지하지 않는다", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });
    fireEvent.click(screen.getByRole("tab", { name: "메뉴" }));
    expect(config.load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "정보" }));

    const map = () => document.querySelector("[data-map-state]");
    await waitFor(() =>
      expect(map()?.getAttribute("data-map-state")).toBe("empty"),
    );
    expect(config.load).toHaveBeenCalledTimes(1);
    expect(map()?.classList.contains("hidden")).toBe(true);
    expect(screen.getByText("서울 강남구 테헤란로 1")).toBeTruthy();
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
