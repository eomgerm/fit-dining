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

import { placeQueries } from "../api/place-queries";
import type { BookmarkAccess } from "../model/bookmark";
import type { Menu, PlaceCard, PlaceDetail } from "../model/place-types";
import { createSearchStore, type SearchStore } from "../model/search-store";
import {
  PlaceDetailScreen,
  type PlaceDetailSlots,
} from "./place-detail-screen";

// 인증은 북마크 테스트(place-detail-bookmark, saved-places)가 본다. 여기서는 비로그인이다
const guest: BookmarkAccess = {
  session: { status: "guest" },
  currentUserId: () => undefined,
  send: () => Promise.reject(new Error("비로그인")),
  endSession: () => {},
  login: () => {},
};

let placeId = 1;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
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
      breaks: [],
      lastOrders: ["21:30"],
      closed: false,
    }),
  ),
  menus: [
    {
      category: "커피",
      name: "아메리카노",
      price: 4500,
      priceText: "4,500원",
      labels: [],
      representative: false,
    },
    {
      category: "디저트",
      name: "치즈케이크",
      labels: [],
      representative: false,
    },
  ],
  facilities: ["무선 인터넷", "주차"],
  subways: [],
  noKidsZone: false,
  seats: [],
  paymentMethods: [],
  broadcasts: [],
  extraLinks: [],
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

const menu = (overrides: Partial<Menu> & { name: string }): Menu => ({
  labels: [],
  representative: false,
  ...overrides,
});

// 테스트마다 상세 응답을 바꿀 수 있다. 기본은 detail이다
let served: PlaceDetail = detail;
function setDetail(overrides: Partial<PlaceDetail>) {
  served = { ...detail, ...overrides };
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  placeId = 1;
  served = detail;
  stores.current = createSearchStore();
  config.load.mockClear();
  fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input) === "/api/v1/places/1"
      ? Response.json(served)
      : Response.json({ status: 404 }, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDetail(
  slots?: PlaceDetailSlots,
  queryClient = createQueryClient(),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <PlaceDetailScreen
          placeId={placeId}
          fromSaved={false}
          slots={slots}
          bookmarks={guest}
        />
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
    // 점수에 넣지 못한 항목의 근거 부족 안내는 숨긴다(D-105)
    expect(
      screen.queryByText("이 장소는 ‘가성비’ 취향을 확인할 근거가 부족해요"),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "핏 점수 84, 설명 보기" }),
    );
    const tip = await screen.findByRole("dialog", { name: "핏 점수 설명" });
    expect(within(tip).getByText(/0~100으로 나타낸 점수예요/)).toBeTruthy();
  });

  it("상단 장소 태그는 검색 카드의 '내 취향' 근거와 같으면 주황, '요청' 근거와 같거나 카드가 없으면 회색이다", async () => {
    const isMatch = (text: string) =>
      screen.getByText(text).className.includes("bg-primary-soft");
    stores.current.recordCards([
      {
        ...card,
        reasons: [
          {
            title: "조용해요",
            tags: [
              { source: "PREFERENCE", label: "조용한" },
              { source: "REQUEST", label: "디저트" },
            ],
          },
        ],
      },
    ]);
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    expect(isMatch("조용한")).toBe(true);
    expect(isMatch("디저트")).toBe(false);

    cleanup();
    stores.current = createSearchStore();
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });
    expect(isMatch("조용한")).toBe(false);
  });

  it("추천 이유 인용은 주황 선에 진한 글자다", async () => {
    stores.current.recordCards([card]);
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    const quote = screen.getByText(/대화하기 좋아요/).closest("blockquote")!;
    expect(quote.classList.contains("border-primary-disabled")).toBe(true);
    expect(quote.classList.contains("text-ink")).toBe(true);
  });

  it("홈 탭 메뉴 미리보기는 대표 메뉴를 먼저, 나머지는 원래 순서로 6개까지 보인다", async () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
    setDetail({
      menus: names.map((name) =>
        menu({ name, representative: name === "g" || name === "h" }),
      ),
    });
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    const preview = screen.getByRole("list", { name: "대표 메뉴" });
    expect(
      within(preview)
        .getAllByRole("listitem")
        .map((item) => item.firstChild?.nextSibling?.textContent),
    ).toEqual(["g", "h", "a", "b", "c", "d"]);
  });

  it("웹사이트 줄은 주소의 도메인만 보이고 링크는 전체 주소다", async () => {
    setDetail({ website: "https://cafeondam.example/" });
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    const link = screen.getByRole("link", {
      name: "cafeondam.example 웹사이트 열기",
    });
    expect(link.textContent).toBe("cafeondam.example");
    expect(link.getAttribute("href")).toBe("https://cafeondam.example/");
  });

  it("휴무 요일은 표 안에 '정기휴무 (매주 <요일>요일)'로 보이고 표 아래 따로 적지 않는다", async () => {
    setDetail({
      hours: detail.hours.map((hours) =>
        hours.dayOfWeek === "SUN"
          ? { ...hours, open: undefined, close: undefined, closed: true }
          : hours,
      ),
      closedDayNote: "매주 일요일 휴무",
    });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "정보" }));
    const sunday = await screen.findByRole("rowheader", { name: /^일/ });
    expect(sunday.nextElementSibling!.textContent).toBe(
      "정기휴무 (매주 일요일)",
    );
    expect(screen.queryByText("매주 일요일 휴무")).toBeNull();
  });

  it("검색 카드에 점수가 없으면 핏 점수를 숨기고 나머지 카드 정보는 그대로 보여 준다", async () => {
    stores.current.recordCards([
      { ...card, score: undefined, reasons: [], scoreItems: [] },
    ]);
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    expect(screen.queryByText("핏 점수")).toBeNull();
    expect(screen.queryByRole("button", { name: /핏 점수/ })).toBeNull();
    expect(screen.queryByText("AI 추천 이유")).toBeNull();
    expect(screen.getByText("주말 오후에는 대기가 길어요")).toBeTruthy();
  });

  it("BE가 점수를 생략한 카드(주의점도 이유도 없음)면 핏 점수와 추천 이유 영역을 모두 숨긴다", async () => {
    stores.current.recordCards([
      {
        place,
        labels: [],
        openStatus: "OPEN",
        reasons: [],
        scoreItems: [],
      },
    ]);
    renderDetail();

    await screen.findByRole("heading", { name: "카페 온담" });
    expect(screen.queryByText("핏 점수")).toBeNull();
    expect(screen.queryByRole("button", { name: /핏 점수/ })).toBeNull();
    expect(screen.queryByText("AI 추천 이유")).toBeNull();
    expect(screen.queryByText(/근거가 부족해요/)).toBeNull();
    expect(screen.getByText("서울 강남구 테헤란로 1")).toBeTruthy();
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

  it("메뉴 탭은 카테고리별 메뉴와 가격 원문을, 정보 탭은 시설을 보여 준다", async () => {
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

  it("메뉴 탭은 원래 순서대로, 이어지는 같은 카테고리마다 머리글을 붙이고 카테고리 없는 메뉴는 그 자리에 보인다", async () => {
    setDetail({
      menus: [
        menu({ category: "커피", name: "아메리카노" }),
        menu({ category: "커피", name: "라떼" }),
        menu({ name: "오늘의 케이크" }),
        menu({ category: "디저트", name: "치즈케이크" }),
        menu({ category: "커피", name: "드립 커피" }),
      ],
    });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "메뉴" }));
    const panel = await screen.findByRole("tabpanel");
    const order = [...panel.querySelectorAll("h2, [data-menu-name]")].map(
      (node) =>
        node.tagName === "H2" ? `# ${node.textContent}` : node.textContent,
    );
    expect(order).toEqual([
      "# 커피",
      "아메리카노",
      "라떼",
      "오늘의 케이크",
      "# 디저트",
      "치즈케이크",
      "# 커피",
      "드립 커피",
    ]);
    expect(within(panel).queryByText(/메뉴 정보 기준일/)).toBeNull();
  });

  it("메뉴 줄에는 64px 사진, 이름 옆 라벨과 '대표' 칩, 두 줄 설명, 오른쪽 가격 원문이 보이고 가격 원문이 없으면 생략한다", async () => {
    setDetail({
      menus: [
        menu({
          name: "[주문제작] 생화 케이크",
          description: "최소 4주 전 문의 부탁드립니다.",
          price: 60000,
          priceText: "가격 변동",
          labels: ["사전예약", "2인이상"],
          representative: true,
          photoUrl: "https://example.com/cake.jpg",
        }),
        menu({ name: "물" }),
      ],
    });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "메뉴" }));
    const panel = await screen.findByRole("tabpanel");
    const [cake, water] = within(panel).getAllByRole("listitem");
    expect(within(cake).getByText("[주문제작] 생화 케이크")).toBeTruthy();
    expect(within(cake).getByText("사전예약")).toBeTruthy();
    expect(within(cake).getByText("2인이상")).toBeTruthy();
    expect(within(cake).getByText("대표")).toBeTruthy();
    expect(
      within(cake).getByText("최소 4주 전 문의 부탁드립니다.").className,
    ).toContain("line-clamp-2");
    expect(within(cake).getByText("가격 변동")).toBeTruthy();
    expect(within(cake).queryByText("60,000원")).toBeNull();
    expect(cake.querySelector(".size-16 img")).toBeTruthy();

    // 사진이 없으면 같은 크기의 자리표시
    expect(water.querySelector(".size-16")).toBeTruthy();
    expect(within(water).queryByText("대표")).toBeNull();
    expect(water.textContent).toBe("물");
  });

  it("메뉴가 없으면 메뉴 줄 없이 안내 문구만 보인다", async () => {
    setDetail({ menus: [] });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "메뉴" }));
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).queryAllByRole("listitem")).toHaveLength(0);
    expect(
      within(panel).getByText("정보가 실제와 다를 수 있어요"),
    ).toBeTruthy();
  });

  it("정보 탭은 시설 아래, 안내 문구 위에 값이 있는 항목만 정해진 순서의 '제목 · 내용' 줄로 보인다", async () => {
    setDetail({
      subways: [
        { station: "역삼역", line: "2", exit: "3", walkMinutes: 4 },
        { station: "강남역", line: "신분당", walkMinutes: 9 },
      ],
      directions: "역삼역 3번 출구에서 직진",
      parking: { free: false, note: "건물 지하 주차장", valet: true },
      bookingUrl: "https://booking.example.com/1",
      pet: { allowed: true, note: "소형견만" },
      noKidsZone: true,
      corkage: { allowed: true, note: "콜키지 유료" },
      seats: [{ name: "단체석", description: "최대 20명" }, { name: "바석" }],
      description: "조용한 동네 카페",
      paymentMethods: ["간편결제", "지역화폐"],
      broadcasts: [
        {
          channel: "KBS2",
          program: "생생정보",
          episode: "100",
          airedOn: "2015-06-29",
          menu: "냉면",
        },
      ],
      extraLinks: ["https://instagram.com/ondam"],
    });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "정보" }));
    const panel = await screen.findByRole("tabpanel");
    await within(panel).findByText("무선 인터넷");
    const terms = within(panel).getAllByRole("term");
    expect(terms.map((term) => term.textContent)).toEqual([
      "지하철",
      "찾아오는 길",
      "주차",
      "예약",
      "반려동물",
      "노키즈존",
      "콜키지",
      "좌석",
      "업체 소개",
      "결제 수단",
      "방송",
      "다른 링크",
    ]);
    // "제목 · 내용"의 내용
    const row = (title: string) =>
      terms
        .find((term) => term.textContent === title)!
        .nextElementSibling!.querySelector<HTMLElement>("[data-info-value]")!;
    expect(row("지하철").textContent).toBe(
      "역삼역 · 2호선 · 3번 출구 · 도보 4분강남역 · 신분당선 · 도보 9분",
    );
    expect(row("주차").textContent).toBe("유료 · 발렛 · 건물 지하 주차장");
    expect(row("반려동물").textContent).toBe("동반 가능 · 소형견만");
    expect(row("콜키지").textContent).toBe("가능 · 콜키지 유료");
    expect(within(row("예약")).getByRole("link").getAttribute("href")).toBe(
      "https://booking.example.com/1",
    );
    expect(row("좌석").textContent).toBe("단체석 · 최대 20명바석");
    expect(row("결제 수단").textContent).toBe("간편결제, 지역화폐");
    expect(row("방송").textContent).toBe(
      "KBS2 · 생생정보 · 100회 · 2015-06-29 · 냉면",
    );
    expect(
      within(row("다른 링크")).getByRole("link").getAttribute("href"),
    ).toBe("https://instagram.com/ondam");
    expect(within(panel).queryByText(/버스/)).toBeNull();

    // 기존 항목(시설) 아래, 안내 문구 위
    const list = terms[0].closest("dl")!;
    const facilities = within(panel).getByText("무선 인터넷").closest("ul")!;
    const note = within(panel).getByText("정보가 실제와 다를 수 있어요");
    expect(
      facilities.compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("정보 탭은 값이 없는 항목의 줄을 숨기고, 노키즈존은 true일 때만 보인다", async () => {
    setDetail({ noKidsZone: false, pet: { allowed: false } });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "정보" }));
    const panel = await screen.findByRole("tabpanel");
    await within(panel).findByText("무선 인터넷");
    expect(
      within(panel)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["반려동물"]);
  });

  it("시설 칩은 이름을 그대로 보이고 묶음마다 다른 아이콘, 묶음에 없는 이름은 기본 아이콘을 붙인다", async () => {
    const byGroup = {
      parking: "발렛파킹",
      wifi: "무선 인터넷",
      group: "단체 이용 가능",
      reservation: "예약",
      takeout: "테이크아웃 할인",
      restroom: "남/녀 화장실 구분",
      kids: "노키즈존",
      wheelchair: "좌석 휠체어 이용가능",
      pet: "반려동물 동반",
      menu: "비건 메뉴",
    };
    setDetail({
      facilities: [...Object.values(byGroup), "간편결제", "대기공간"],
    });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "정보" }));
    const panel = await screen.findByRole("tabpanel");
    const chips = [
      ...(await within(panel).findByText("발렛파킹")).closest("ul")!.children,
    ];
    const icon = (chip: Element) => chip.querySelector("svg")!;
    expect(
      chips.map((chip) => [chip.textContent, icon(chip).dataset.icon]),
    ).toEqual([
      ...Object.entries(byGroup).map(([group, name]) => [name, group]),
      ["간편결제", "default"],
      ["대기공간", "default"],
    ]);
    // 묶음 10개와 기본 아이콘은 모양이 모두 다르다
    const shapes = chips.map((chip) => icon(chip).innerHTML);
    expect(new Set(shapes.slice(0, 11)).size).toBe(11);
    expect(shapes[11]).toBe(shapes[10]);
  });

  it("영업시간 표는 정보 없는 요일을 '정보 없음'으로, 24시간 영업과 24:00 마감과 자정 넘김을 구분해 보인다", async () => {
    const changed: Record<string, Partial<PlaceDetail["hours"][number]>> = {
      MON: { open: undefined, close: undefined, lastOrders: [] },
      TUE: { open: "00:00", close: "00:00" },
      WED: { open: "17:00", close: "02:00" },
      THU: { open: "11:00", close: "00:00" },
    };
    setDetail({
      hours: detail.hours.map((hours) => ({
        ...hours,
        ...changed[hours.dayOfWeek],
      })),
    });
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("tab", { name: "정보" }));
    const cell = async (day: string) =>
      (await screen.findByRole("rowheader", { name: new RegExp(`^${day}`) }))
        .nextElementSibling!.firstChild!.textContent;
    expect(await cell("월")).toBe("정보 없음");
    expect(await cell("화")).toBe("24시간 영업");
    expect(await cell("수")).toBe("17:00 – 02:00");
    expect(await cell("목")).toBe("11:00 – 24:00");
    expect(screen.queryByText("휴무")).toBeNull();
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

  // 저장 버튼은 북마크 기능이 대체했다(place-detail-bookmark.test.tsx)
  it("'공유' 버튼은 '준비 중이에요'를 띄운다", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("button", { name: "공유" }));

    expect(await screen.findByText("준비 중이에요")).toBeTruthy();
  });

  it("비로그인이면 '저장'은 로그인 안내를 띄운다", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "카페 온담" });

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("로그인이 필요해요")).toBeTruthy();
    expect(screen.queryByText("준비 중이에요")).toBeNull();
  });

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

  // 서버가 BE를 읽지 못해 비워 둔 뒤 브라우저가 받은 404다. 서버가 404를 받았으면 페이지가 not-found를 그린다
  it("모르는 장소면 '장소를 찾을 수 없어요'를 보여 준다", async () => {
    placeId = 999;
    renderDetail();

    expect(await screen.findByText("장소를 찾을 수 없어요")).toBeTruthy();
  });

  // 서버가 방금 그려 넣은 상세를 브라우저가 곧바로 다시 받지 않는다
  it("서버가 넣은 장소 정보가 새것이면 열 때 다시 받지 않는다", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(placeQueries.detail(1).queryKey, detail);
    renderDetail(undefined, queryClient);

    expect(screen.getByRole("heading", { name: "카페 온담" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/places/1",
      expect.anything(),
    );
  });

  // 오래된 상세를 다시 받다가 실패해도 보이던 내용을 지우지 않는다
  it("이미 받은 장소 정보가 있으면 다시 받기에 실패해도 장소를 계속 보인다", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: 400 }, { status: 400 }),
    );
    const queryClient = createQueryClient();
    queryClient.setQueryData(placeQueries.detail(1).queryKey, detail, {
      updatedAt: Date.now() - 10 * 60 * 1000,
    });
    renderDetail(undefined, queryClient);

    await waitFor(() =>
      expect(
        queryClient.getQueryState(placeQueries.detail(1).queryKey)?.status,
      ).toBe("error"),
    );
    expect(screen.getByRole("heading", { name: "카페 온담" })).toBeTruthy();
  });

  // 400은 재시도하지 않아 곧바로 실패한다
  it("장소 정보를 받지 못하면 안내와 '다시 시도'를 보이고, 다시 시도하면 장소를 보인다", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: 400 }, { status: 400 }),
    );
    renderDetail();

    expect(
      await screen.findByText("장소 정보를 불러오지 못했어요"),
    ).toBeTruthy();
    expect(screen.getByText("잠시 후 다시 시도해 주세요.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(
      await screen.findByRole("heading", { name: "카페 온담" }),
    ).toBeTruthy();
  });
});
