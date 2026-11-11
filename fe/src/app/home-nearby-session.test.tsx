// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domains/auth/api/auth-client";
import type { BookmarkAccess } from "@/domains/place/model/bookmark";
import type {
  PlaceCard,
  PlaceSearchResponse,
} from "@/domains/place/model/place-types";
import { searchStore } from "@/domains/place/model/search-store";
import { SearchScreen } from "@/domains/place/ui/search-screen";
import {
  BOUNDS,
  stubNaverMaps,
} from "@/domains/place/ui/testing/naver-maps-stub";
import { resetThreadSession } from "@/domains/place/ui/thread-storage";

import { Providers } from "./providers";
import { threadAuth } from "./search-thread-auth";

// 홈 주변 카드와 로그인 세션 변경을 실제 Providers의 비우기 연결(clearOnSessionChange)과 같은 QueryClient로 돌린다
// (place-search AC-66, AC-68). auth-client, 지도 SDK, 서버만 가짜다
const auth = vi.hoisted(() => ({
  session: null as AuthSession | null,
  listeners: new Set<() => void>(),
}));

function setSession(next: AuthSession | null) {
  auth.session = next;
  auth.listeners.forEach((listener) => listener());
}

vi.mock("@/domains/auth/api/auth-client", () => ({
  ACCESS_TOKEN_EXPIRED_TYPE: "urn:fitdining:auth:access-token-expired",
  getSession: () => auth.session,
  restore: async () => {
    if (auth.session) return auth.session;
    const { ApiError } = await import("@/shared/api/api-error");
    throw new ApiError("http", "x", { status: 401 });
  },
  refresh: async () => {
    throw new Error("갱신하지 않는다");
  },
  clearSession: () => setSession(null),
  subscribe: (listener: () => void) => {
    auth.listeners.add(listener);
    return () => auth.listeners.delete(listener);
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/lib/runtime-config", () => ({
  loadRuntimeConfig: async () => ({ env: "dev", naverMapClientId: "key" }),
}));

const member = (userId: string): AuthSession => ({
  userId,
  nickname: userId,
  sessionExpiresAt: 1,
});

function card(id: number): PlaceCard {
  return {
    place: {
      id,
      name: `장소 ${id}`,
      categoryGroup: "CAFE",
      station: "YEOKSAM",
      lat: 37.5,
      lng: 127.03,
    },
    score: 80,
    labels: [],
    openStatus: "OPEN",
    reasons: [],
    scoreItems: [],
  };
}

// 홈 주변 카드 요청 본문. 응답 카드는 몇 번째 요청인지로 이름이 달라(장소 11, 장소 12 …) 어느 세션의 카드인지 가린다
let nearbyBodies: Record<string, unknown>[];

async function handle(url: string, init?: RequestInit): Promise<Response> {
  if (url.startsWith("/api/v1/places/suggest")) return Response.json([]);
  if (url === "/api/v1/places/nearby") {
    nearbyBodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      conditions: {},
      nearby: true,
      totalCount: 1,
      items: [card(10 + nearbyBodies.length)],
    } satisfies PlaceSearchResponse);
  }
  if (url === "/api/v1/places/search") {
    return Response.json({
      conditions: {},
      nearby: false,
      totalCount: 1,
      items: [card(1)],
    } satisfies PlaceSearchResponse);
  }
  if (url.startsWith("/api/v1/me/search-threads")) {
    return init?.method === "PUT"
      ? new Response(null, { status: 204 })
      : Response.json({ items: [] });
  }
  throw new Error(`예상 밖 요청 ${url}`);
}

const noBookmarks: BookmarkAccess = {
  session: { status: "guest" },
  currentUserId: () => undefined,
  send: () => Promise.reject(new Error("비로그인")),
  endSession: () => {},
  login: () => {},
};

// 상세나 내 정보 화면으로 가면 Next가 검색 화면을 숨긴다(Activity). Providers는 그대로 남는다
function renderApp() {
  const ui = (mode: "visible" | "hidden") => (
    <Providers>
      <Activity mode={mode}>
        <SearchScreen bookmarks={noBookmarks} threadAuth={threadAuth} />
      </Activity>
    </Providers>
  );
  const { rerender } = render(ui("visible"));
  return {
    hide: () => rerender(ui("hidden")),
    show: () => rerender(ui("visible")),
  };
}

const nearbyList = () =>
  screen.findByRole("region", { name: "주변 추천 장소" });
const skeleton = () =>
  screen.queryByRole("status", { name: "주변 추천을 불러오는 중" });

let map: ReturnType<typeof stubNaverMaps>;

beforeEach(() => {
  nearbyBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => handle(String(input), init)),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  map = stubNaverMaps();
  localStorage.clear();
  searchStore.reset();
  resetThreadSession();
  setSession(member("u1"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 지도가 준비되고 처음 홈 요청의 카드를 받을 때까지
async function openHome() {
  const view = renderApp();
  const list = await nearbyList();
  expect(within(list).getByText("장소 11")).toBeTruthy();
  return view;
}

describe("홈 주변 카드와 로그인 세션 (S15P31A302-204)", () => {
  it("홈이 보이는 동안 로그인 세션이 바뀌면 같은 영역의 cache가 비워져 한 번 더 받고, 이전 세션의 카드는 보이지 않는다 (AC-66, AC-68)", async () => {
    await openHome();

    act(() => setSession(member("u2")));

    expect(screen.queryByText("장소 11")).toBeNull();
    expect(await screen.findByText("장소 12")).toBeTruthy();
    expect(nearbyBodies).toEqual([
      { mapBounds: BOUNDS },
      { mapBounds: BOUNDS },
    ]);
  });

  it("홈이 보이는 동안 세션이 바뀌면 지도를 움직이지 않고 그때 끈 화면의 영역으로 한 번 받는다 (AC-68)", async () => {
    await openHome();
    const moved = { swLat: 37.5, swLng: 127.04, neLat: 37.52, neLng: 127.07 };
    map.fire("dragend");
    map.view.bounds = moved;
    map.fire("idle");

    act(() => setSession(member("u2")));

    expect(await screen.findByText("장소 12")).toBeTruthy();
    expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }, { mapBounds: moved }]);
    expect(map.created[0].panTo).not.toHaveBeenCalled();
    expect(map.created[0].morph).not.toHaveBeenCalled();
  });

  it("홈이 숨은 동안 세션이 바뀌면 그동안은 받지 않고, 다시 보일 때 새 영역을 확정해 한 번 받는다 (AC-68)", async () => {
    const view = await openHome();

    view.hide();
    act(() => setSession(member("u2")));
    await act(async () => {});
    expect(nearbyBodies).toHaveLength(1);

    view.show();
    expect(skeleton()).toBeTruthy();
    expect(screen.queryByText("장소 11")).toBeNull();
    expect(await screen.findByText("장소 12")).toBeTruthy();
    await act(async () => {});
    expect(nearbyBodies).toHaveLength(2);
  });

  it("세션 변경과 홈 진입이 같은 렌더에 겹쳐도 요청은 한 번이다 (AC-68)", async () => {
    await openHome();
    fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
      target: { value: "역삼 카페" },
    });
    fireEvent.submit(screen.getByRole("search"));
    await screen.findByRole("list", { name: "추천 장소" });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
      setSession(member("u2"));
    });

    expect(await screen.findByText("장소 12")).toBeTruthy();
    await act(async () => {});
    expect(nearbyBodies).toHaveLength(2);
  });
});
