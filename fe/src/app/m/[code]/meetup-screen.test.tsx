// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markJustJoined } from "@/domains/meetup/model/just-joined";
import type { MeetupSnapshot } from "@/domains/meetup/model/meetup";
import type { MeetupResult } from "@/domains/meetup/model/result";
import { ApiError } from "@/shared/api/api-error";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { MeetupScreen } from "./meetup-screen";

const api = vi.hoisted(() => ({
  createMeetup: vi.fn(),
  searchAreas: vi.fn(),
  fetchSnapshot: vi.fn(),
  createProfile: vi.fn(),
  selectProfile: vi.fn(),
  updateTaste: vi.fn(),
  removeProfile: vi.fn(),
  startCalculation: vi.fn(),
  fetchResult: vi.fn(),
}));
vi.mock("@/domains/meetup/api/meetup-api", () => api);

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  rememberLoginReturn: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    back: vi.fn(),
  }),
}));
vi.mock("../../login-return", () => ({
  rememberLoginReturn: mocks.rememberLoginReturn,
}));

const CODE = "AbCdEfGhIjKlMnOpQrStUv";

function snapshot(overrides: Partial<MeetupSnapshot> = {}): MeetupSnapshot {
  return {
    phase: "WAITING",
    afterMeetup: false,
    info: {
      area: { kind: "STATION", name: "선릉" },
      category: "RESTAURANT",
      date: "2026-11-14",
      time: "19:00",
      headcount: 4,
      description: "편하게 얘기하면서 저녁 먹을 곳",
      hostNickname: "민지",
      expiresOn: "2026-11-21",
    },
    questions: { mood: true, food: true, spicy: true, price: false },
    me: { role: "VIEWER", signedIn: false },
    allowed: ["JOIN"],
    profiles: [
      {
        id: 1,
        name: "민지",
        color: 0,
        member: true,
        host: true,
        reflected: false,
      },
      {
        id: 2,
        name: "하린",
        color: 2,
        member: false,
        host: false,
        reflected: false,
      },
    ],
    pendingCount: 2,
    ...overrides,
  };
}

function mount(view?: "profiles") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MeetupScreen code={CODE} view={view} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("모임 링크 화면", () => {
  it("프로필이 없으면 모임 정보와 이름 목록, 배지 설명을 보인다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    mount();
    expect(await screen.findByText("내 이름을 골라 주세요")).toBeTruthy();
    expect(screen.getByText("민지님의 모임")).toBeTruthy();
    expect(screen.getByText("11월 14일 (토) 저녁 7시")).toBeTruthy();
    expect(screen.getByRole("button", { name: /하린/ })).toBeTruthy();
    expect(
      screen.getByText(/회원 프로필은 로그인해야 들어갈 수 있어요/),
    ).toBeTruthy();
  });

  it("비회원 이름을 고르면 한 번 묻고, 맞으면 그 이름으로 들어간다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    api.selectProfile.mockResolvedValue(undefined);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /하린/ }));
    expect(await screen.findByText("하린님이 맞나요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "맞아요" }));
    await waitFor(() =>
      expect(api.selectProfile).toHaveBeenCalledWith(CODE, 2),
    );
  });

  it("로그인하지 않고 회원 이름을 고르면 로그인 안내 뒤 이 모임으로 돌아올 주소를 남긴다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /민지/ }));
    expect(
      await screen.findByText(/민지님은 회원으로 참여했어요/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(mocks.rememberLoginReturn).toHaveBeenCalledWith(`/m/${CODE}`);
    expect(mocks.push).toHaveBeenCalledWith("/login");
  });

  it("정한 인원만큼 참여했으면 처음 왔어요를 누를 때 한 번 묻는다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      snapshot({
        info: { ...snapshot().info, headcount: 2 },
        pendingCount: undefined,
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /처음 왔어요/ }));
    expect(await screen.findByText("이미 2명이 참여했어요")).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole("button", { name: "처음 왔어요" }).at(-1)!,
    );
    expect(mocks.push).toHaveBeenCalledWith(`/m/${CODE}/join`);
  });

  it("결과만 보기는 프로필 없이 대기 화면을 연다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "결과만 보기" }));
    expect(
      screen.getByRole("heading", { name: /취향을 남긴 친구/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "내 이름 고르기" })).toBeTruthy();
  });

  it("모임장에게 프로필이 없으면 질문지로 보낸다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      snapshot({ me: { role: "HOST", signedIn: true } }),
    );
    mount();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(`/m/${CODE}/join`),
    );
  });

  it("프로필이 있으면 대기 화면이고, 방금 남겼으면 취향을 남겼어요를 보인다", async () => {
    const participant = snapshot({
      me: { role: "PARTICIPANT", profileId: 2, signedIn: false },
      allowed: ["EDIT_TASTE"],
    });
    api.fetchSnapshot.mockResolvedValue(participant);
    markJustJoined(CODE);
    mount();
    expect(await screen.findByText("취향을 남겼어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내 취향 수정" }));
    expect(mocks.push).toHaveBeenCalledWith(`/m/${CODE}/taste`);
    cleanup();

    mount();
    expect(
      await screen.findByText("민지님이 추천받으면 여기서 같이 볼 수 있어요."),
    ).toBeTruthy();
  });

  it("취향을 남겼어요에서 친구들 취향 보기를 누르면 대기 화면이다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      snapshot({
        me: { role: "PARTICIPANT", profileId: 2, signedIn: false },
        allowed: ["EDIT_TASTE"],
      }),
    );
    markJustJoined(CODE);
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "친구들 취향 보기" }),
    );
    expect(
      screen.getByRole("heading", { name: /취향을 남긴 친구/ }),
    ).toBeTruthy();
    expect(screen.queryByText("취향을 남겼어요")).toBeNull();
  });

  it("없는 코드(404)면 없는 링크 화면이다", async () => {
    api.fetchSnapshot.mockRejectedValue(
      new ApiError("http", "not found", { status: 404 }),
    );
    mount();
    expect(await screen.findByText("없거나 끝난 모임이에요")).toBeTruthy();
    expect(api.fetchSnapshot).toHaveBeenCalledTimes(1);
  });
});

const RESULT: MeetupResult = {
  calculationId: 5,
  calculatedAt: "2026-11-11T09:12:00Z",
  tasteCount: 2,
  applied: { mood: "QUIET" },
  items: [
    {
      rank: 1,
      place: { id: 10, name: "숯불 마당", categoryGroup: "RESTAURANT" },
      openStatus: "OPEN",
      score: 86,
      group: "ALL_FIT",
      fit: { kind: "ALL", fitProfileIds: [1, 2] },
      reasons: [
        {
          title: "모임",
          tags: [{ source: "REQUEST", label: "모임하기 좋아요" }],
        },
      ],
      menu: { name: "숙성 삼겹살", price: 16000 },
      facilities: { group: true },
      distance: { station: "선릉역", walkMinutes: 4 },
    },
    {
      rank: 2,
      place: { id: 11, name: "연기 한 점", categoryGroup: "RESTAURANT" },
      score: 79,
      group: "SOME_MISFIT",
      fit: {
        kind: "MISFIT",
        fitProfileIds: [1],
        misfitProfileIds: [2],
        missedMenus: [{ profileId: 2, menu: "곱창" }],
      },
      reasons: [],
    },
  ],
};

const SUCCEEDED = {
  id: 5,
  state: "SUCCEEDED" as const,
  startedAt: "2026-11-11T09:11:58Z",
  tasteCount: 2,
  outdated: false,
};

function hostSnapshot(overrides: Partial<MeetupSnapshot> = {}) {
  return snapshot({
    me: { role: "HOST", profileId: 1, signedIn: true, tasteReflected: true },
    allowed: ["CALCULATE", "EDIT_INFO", "REMOVE_PROFILE", "EDIT_TASTE"],
    ...overrides,
  });
}

function resultSnapshot(overrides: Partial<MeetupSnapshot> = {}) {
  return snapshot({
    phase: "RESULT",
    me: {
      role: "PARTICIPANT",
      profileId: 2,
      signedIn: false,
      tasteReflected: true,
    },
    allowed: ["EDIT_TASTE"],
    calculation: SUCCEEDED,
    resultCalculationId: 5,
    ...overrides,
  });
}

describe("추천받기와 결과", () => {
  it("모임장은 대기 화면에서 추천받기를 누르면 계산을 시작한다", async () => {
    api.fetchSnapshot.mockResolvedValue(hostSnapshot());
    api.startCalculation.mockResolvedValue(undefined);
    mount();
    expect(
      await screen.findByText("다 모이지 않아도 추천받을 수 있어요"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "추천받기" }));
    await waitFor(() =>
      expect(api.startCalculation).toHaveBeenCalledWith(CODE),
    );
  });

  it("계산 중이면 누구에게나 찾는 중을 보이고 1초마다 스냅숏을 다시 받는다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.fetchSnapshot.mockResolvedValue(
        resultSnapshot({
          phase: "WAITING",
          calculation: { ...SUCCEEDED, state: "RUNNING" },
          resultCalculationId: undefined,
        }),
      );
      mount();
      expect(
        await screen.findByText("2명의 취향에 맞는 곳을 찾고 있어요"),
      ).toBeTruthy();
      const before = api.fetchSnapshot.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      await waitFor(() =>
        expect(api.fetchSnapshot.mock.calls.length).toBeGreaterThan(before),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("결과가 있으면 묶음별 카드를 보이고 본문은 모임에서 연 장소 상세로 간다", async () => {
    api.fetchSnapshot.mockResolvedValue(resultSnapshot());
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    expect(await screen.findByText("2명의 취향으로 추천했어요")).toBeTruthy();
    expect(screen.getByText("조용한 곳")).toBeTruthy();
    expect(screen.getByText("토 저녁 7시 영업")).toBeTruthy();
    expect(screen.getByText("모두에게 잘 맞는 곳")).toBeTruthy();
    expect(screen.getByText("취향이 조금 갈리는 곳")).toBeTruthy();
    expect(screen.getByText("모두에게 잘 맞아요")).toBeTruthy();
    expect(screen.getByText("하린님이 원한 곱창은 아니에요")).toBeTruthy();
    expect(screen.getByText("모임하기 좋아요")).toBeTruthy();
    expect(screen.getByText("단체 이용 가능")).toBeTruthy();
    expect(screen.getByText("숙성 삼겹살 16,000원")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /숯불 마당/ }).getAttribute("href"),
    ).toBe(`/places/10?meetup=${CODE}`);
    expect(
      screen.getByText("민지님이 투표를 열면 여기서 투표할 수 있어요."),
    ).toBeTruthy();
    expect(api.fetchResult).toHaveBeenCalledWith(CODE, expect.anything());
  });

  it("모임 점수가 없으면 핏 점수와 그 설명을 보이지 않는다", async () => {
    api.fetchSnapshot.mockResolvedValue(resultSnapshot());
    api.fetchResult.mockResolvedValue({
      ...RESULT,
      items: RESULT.items.map((item) => ({ ...item, score: undefined })),
    });
    mount();
    expect(await screen.findByText("숯불 마당")).toBeTruthy();
    expect(screen.queryByText("핏 점수")).toBeNull();
    expect(screen.queryByText(/핏 점수는 모임 설명과/)).toBeNull();
  });

  it("결과 전에 계산이 실패하면 모임장에게만 다시 시도를 보인다", async () => {
    const failed = { ...SUCCEEDED, state: "FAILED" as const };
    api.fetchSnapshot.mockResolvedValue(hostSnapshot({ calculation: failed }));
    api.startCalculation.mockResolvedValue(undefined);
    mount();
    expect(await screen.findByText("추천을 불러오지 못했어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() =>
      expect(api.startCalculation).toHaveBeenCalledWith(CODE),
    );
    cleanup();

    api.fetchSnapshot.mockResolvedValue(
      resultSnapshot({
        phase: "WAITING",
        calculation: failed,
        resultCalculationId: undefined,
      }),
    );
    mount();
    expect(
      await screen.findByText("민지님이 추천받으면 여기서 같이 볼 수 있어요."),
    ).toBeTruthy();
  });

  it("낡은 결과에서 모임장은 다시 추천받기를, 반영되지 않은 참여자는 안내를 본다", async () => {
    const stale = { ...SUCCEEDED, outdated: true };
    const profiles = snapshot().profiles.map((profile) => ({
      ...profile,
      reflected: profile.id !== 2,
    }));
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "RESULT",
        calculation: stale,
        resultCalculationId: 5,
        profiles,
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    expect(
      await screen.findByText("하린님이 방금 취향을 남겼어요"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 추천받기" })).toBeTruthy();
    cleanup();

    api.fetchSnapshot.mockResolvedValue(
      resultSnapshot({
        calculation: stale,
        profiles,
        me: {
          role: "PARTICIPANT",
          profileId: 2,
          signedIn: false,
          tasteReflected: false,
        },
      }),
    );
    mount();
    expect(
      await screen.findByText(/내 취향은 아직 추천에 반영되지 않았어요/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 추천받기" })).toBeNull();
  });

  it("친구들 취향 보기는 친구들의 취향을 시트로 연다", async () => {
    api.fetchSnapshot.mockResolvedValue(resultSnapshot());
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "친구들 취향 보기" }),
    );
    expect(await screen.findByText(/모임 날로부터 7일 뒤/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "내 취향 수정" })).toBeTruthy();
  });

  it("결과가 있으면 취향을 남겼어요의 버튼이 추천 결과 보기다", async () => {
    api.fetchSnapshot.mockResolvedValue(resultSnapshot());
    api.fetchResult.mockResolvedValue(RESULT);
    markJustJoined(CODE);
    mount();
    expect(await screen.findByText("취향을 남겼어요")).toBeTruthy();
    expect(screen.queryByText(/추천이 나오면/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "추천 결과 보기" }));
    expect(await screen.findByText("2명의 취향으로 추천했어요")).toBeTruthy();
  });

  it("결과만 보기는 결과가 있으면 프로필 없이 결과를 연다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      resultSnapshot({
        me: { role: "VIEWER", signedIn: false },
        allowed: ["JOIN"],
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "결과만 보기" }));
    expect(await screen.findByText("2명의 취향으로 추천했어요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "내 이름 고르기" })).toBeTruthy();
  });
});
