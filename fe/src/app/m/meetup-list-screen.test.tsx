// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MeetupListItem } from "@/domains/meetup/model/meetup";
import { ApiError } from "@/shared/api/api-error";

import { MeetupListScreen } from "./meetup-list-screen";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  rememberLoginReturn: vi.fn(),
  fetchMyMeetups: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
    push: mocks.push,
    back: mocks.back,
  }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  restore: mocks.restore,
}));
vi.mock("@/domains/auth/api/authenticated", () => ({
  authenticated: <T,>(send: () => Promise<T>) => send(),
}));
vi.mock("@/domains/meetup/api/meetup-api", () => ({
  fetchMyMeetups: mocks.fetchMyMeetups,
}));
vi.mock("../login-return", () => ({
  rememberLoginReturn: mocks.rememberLoginReturn,
}));

// 바로 앞 기록을 path로 둔다
function previousEntry(path: string) {
  vi.stubGlobal("navigation", {
    currentEntry: { index: 1 },
    entries: () => [
      { url: `${location.origin}${path}` },
      { url: location.href },
    ],
  });
}

const item = (patch: Partial<MeetupListItem>): MeetupListItem => ({
  code: "AbCdEfGhIjKlMnOpQrStUv",
  role: "HOST",
  phase: "WAITING",
  area: { kind: "STATION", name: "선릉" },
  category: "RESTAURANT",
  profileCount: 0,
  ...patch,
});

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MeetupListScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.restore.mockResolvedValue({ userId: "u1", nickname: "민재" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("내 모임", () => {
  it("진행 중인 모임을 위에, 끝난 모임을 아래에 두고 만든 모임에만 왕관을 붙인다", async () => {
    mocks.fetchMyMeetups.mockResolvedValue({
      items: [
        item({
          code: "AAAAAAAAAAAAAAAAAAAAAA",
          date: "2026-11-14",
          time: "19:00",
          headcount: 4,
          profileCount: 3,
        }),
        item({
          code: "BBBBBBBBBBBBBBBBBBBBBB",
          role: "PARTICIPANT",
          phase: "VOTING",
          area: { kind: "DONG", name: "역삼동" },
          category: "CAFE",
        }),
        item({
          code: "CCCCCCCCCCCCCCCCCCCCCC",
          role: "PARTICIPANT",
          phase: "DECIDED",
          area: { kind: "STATION", name: "강남" },
          decidedPlaceName: "숯불 마당",
        }),
      ],
    });
    mount();

    const ongoing = await screen.findByRole("region", { name: "진행 중" });
    const ended = screen.getByRole("region", { name: "끝난 모임" });
    const [host, member] = within(ongoing).getAllByRole("link");
    expect(host.getAttribute("href")).toBe("/m/AAAAAAAAAAAAAAAAAAAAAA");
    expect(within(host).getByText("선릉역 모임")).toBeTruthy();
    expect(within(host).getByRole("img", { name: "모임장" })).toBeTruthy();
    expect(
      within(host).getByText("취향 모으는 중 · 3명 남겼어요"),
    ).toBeTruthy();
    expect(
      within(host).getByText("11월 14일 (토) 저녁 7시 · 식당 · 4명"),
    ).toBeTruthy();
    expect(within(member).queryByRole("img", { name: "모임장" })).toBeNull();
    expect(within(member).getByText("투표 중")).toBeTruthy();
    expect(within(member).getByText("날짜 미정 · 카페")).toBeTruthy();
    expect(within(ended).getByText("숯불 마당으로 정했어요")).toBeTruthy();
    expect(screen.getByText(/로그인하고 참여한 모임만 보여요/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "새로운 모임 만들기" }));
    expect(mocks.push).toHaveBeenCalledWith("/m/new");
  });

  it("모임이 없으면 소개와 만들기 버튼만 보인다", async () => {
    mocks.fetchMyMeetups.mockResolvedValue({ items: [] });
    mount();
    expect(
      await screen.findByRole("heading", {
        name: "친구들과 갈 곳을 같이 정해요",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(
      screen.getByRole("button", { name: "새로운 모임 만들기" }),
    ).toBeTruthy();
  });

  it("한 묶음에 20개를 넘으면 더 보기로 나머지를 보인다", async () => {
    mocks.fetchMyMeetups.mockResolvedValue({
      items: Array.from({ length: 21 }, (_, index) =>
        item({ code: String(index).padStart(22, "A") }),
      ),
    });
    mount();
    const ongoing = await screen.findByRole("region", { name: "진행 중" });
    expect(within(ongoing).getAllByRole("link")).toHaveLength(20);
    fireEvent.click(within(ongoing).getByRole("button", { name: "더 보기" }));
    expect(within(ongoing).getAllByRole("link")).toHaveLength(21);
  });

  it("로그인하지 않았으면 로그인 안내를 띄우고, 로그인 뒤 이 화면으로 돌아올 주소를 남긴다", async () => {
    mocks.restore.mockRejectedValue(new Error("401"));
    mocks.fetchMyMeetups.mockRejectedValue(
      new ApiError("http", "unauthorized", { status: 401 }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "로그인" }));
    expect(mocks.rememberLoginReturn).toHaveBeenCalledWith("/m");
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("홈에서 왔으면 뒤로가 홈으로 돌아간다", async () => {
    previousEntry("/");
    mocks.fetchMyMeetups.mockResolvedValue({ items: [] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "뒤로" }));
    expect(mocks.back).toHaveBeenCalled();
  });

  it("모임 화면에서 왔어도 뒤로는 그 모임이 아니라 홈으로 간다", async () => {
    previousEntry("/m/AbCdEfGhIjKlMnOpQrStUv");
    mocks.fetchMyMeetups.mockResolvedValue({ items: [] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "뒤로" }));
    expect(mocks.replace).toHaveBeenCalledWith("/");
    expect(mocks.back).not.toHaveBeenCalled();
  });
});
