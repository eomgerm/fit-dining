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
  openPoll: vi.fn(),
  vote: vi.fn(),
  closePoll: vi.fn(),
  reopenPoll: vi.fn(),
  decide: vi.fn(),
  cancelDecision: vi.fn(),
  linkAccount: vi.fn(),
}));
vi.mock("@/domains/meetup/api/meetup-api", () => api);

// 회원 프로필로 바꾸기는 로그인을 확인하고 보낸다. 테스트는 로그인한 것으로 둔다
vi.mock("@/domains/auth/api/authenticated", () => ({
  authenticated: (send: (session: unknown) => unknown) => send({}),
}));

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

  it("다른 곳에는 있는 모임 점수가 없는 곳은 맨 뒤의 정보가 적은 곳 묶음에 보인다", async () => {
    api.fetchSnapshot.mockResolvedValue(resultSnapshot());
    api.fetchResult.mockResolvedValue({
      ...RESULT,
      items: [
        ...RESULT.items,
        {
          rank: 3,
          place: { id: 12, name: "골목 식당", categoryGroup: "RESTAURANT" },
          group: "UNSCORED",
          fit: { kind: "MOSTLY", fitProfileIds: [1, 2] },
          reasons: [],
        },
      ],
    });
    mount();
    expect(await screen.findByText("아직 정보가 적은 곳")).toBeTruthy();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "모두에게 잘 맞는 곳",
      "취향이 조금 갈리는 곳",
      "아직 정보가 적은 곳",
    ]);
    const last = screen.getByText("아직 정보가 적은 곳").closest("section");
    expect(last?.textContent).toContain("골목 식당");
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

describe("모임 정보 수정 버튼", () => {
  it("모임장은 대기 화면 모임 정보의 수정으로 수정 화면을 연다", async () => {
    api.fetchSnapshot.mockResolvedValue(hostSnapshot());
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "모임 정보 수정" }),
    );
    expect(mocks.push).toHaveBeenCalledWith(`/m/${CODE}/edit`);
  });

  it("모임장은 결과 화면 첫 줄의 수정으로도 연다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "RESULT",
        calculation: SUCCEEDED,
        resultCalculationId: 5,
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    expect(await screen.findByText("2명의 취향으로 추천했어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "모임 정보 수정" }));
    expect(mocks.push).toHaveBeenCalledWith(`/m/${CODE}/edit`);
  });

  it("날짜·시간만 고칠 수 있어도 수정이 보이고, 고칠 수 없는 사람에게는 없다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "VOTING",
        allowed: ["EDIT_DATE"],
        calculation: SUCCEEDED,
        resultCalculationId: 5,
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    expect(
      await screen.findByRole("button", { name: "모임 정보 수정" }),
    ).toBeTruthy();
    cleanup();

    api.fetchSnapshot.mockResolvedValue(resultSnapshot());
    mount();
    expect(await screen.findByText("2명의 취향으로 추천했어요")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "모임 정보 수정" })).toBeNull();
  });
});

const OPEN_POLL = {
  state: "OPEN" as const,
  anonymous: true,
  tie: false,
  reopenable: false,
  candidates: [
    { placeId: 10, votes: 1 },
    { placeId: 11, votes: 0 },
  ],
  votedCount: 1,
  notVotedCount: 1,
};

function conflict(type: string) {
  return new ApiError("http", "conflict", {
    status: 409,
    problem: { type: `urn:fitdining:meetup:${type}`, status: 409 },
  });
}

describe("투표와 정하기", () => {
  it("모임장은 결과 카드에서 두 곳 이상을 골라 투표를 연다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "RESULT",
        allowed: ["OPEN_POLL", "DECIDE", "EDIT_INFO", "REMOVE_PROFILE"],
        calculation: SUCCEEDED,
        resultCalculationId: 5,
        profiles: snapshot().profiles.map((profile) => ({
          ...profile,
          reflected: true,
        })),
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    api.openPoll.mockResolvedValue(undefined);
    mount();
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(2);

    fireEvent.click(boxes[0]);
    expect(
      await screen.findByText(/2곳 이상 골라야 투표를 열 수 있어요/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "투표 열기" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(boxes[1]);
    fireEvent.click(await screen.findByRole("button", { name: "투표 열기" }));
    expect(await screen.findByText("후보 2곳으로 투표를 열어요")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
    const buttons = screen.getAllByRole("button", { name: "투표 열기" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(api.openPoll).toHaveBeenCalledWith(CODE, {
        placeIds: [10, 11],
        anonymous: true,
      }),
    );
  });

  it("투표 열기 시트는 추천에 반영되지 않은 취향을 알린다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "RESULT",
        allowed: ["OPEN_POLL", "DECIDE", "CALCULATE"],
        calculation: { ...SUCCEEDED, outdated: true },
        resultCalculationId: 5,
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(await screen.findByRole("button", { name: "투표 열기" }));
    expect(
      await screen.findByText(
        /민지님, 하린님 취향은 아직 추천에 반영되지 않았어요/,
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "다시 추천받기" }).length,
    ).toBeGreaterThan(0);
  });

  it("모임장은 카드에서 바로 정하기 전에 한 번 묻는다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "RESULT",
        allowed: ["OPEN_POLL", "DECIDE"],
        calculation: SUCCEEDED,
        resultCalculationId: 5,
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    api.decide.mockResolvedValue(undefined);
    mount();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "여기로 정하기" }))[0],
    );
    expect(await screen.findByText("숯불 마당으로 정할까요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "정하기" }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith(CODE, 10));
  });

  it("참여자는 익명 투표 화면에서 한 곳을 고르고, 마감돼 실패하면 선택을 되돌린다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      resultSnapshot({
        phase: "VOTING",
        allowed: ["EDIT_TASTE", "VOTE"],
        poll: { ...OPEN_POLL, hasVoted: false },
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    api.vote.mockRejectedValue(conflict("poll-closed"));
    mount();
    expect(await screen.findByText("익명 투표예요")).toBeTruthy();
    expect(
      screen.getByText("민지님이 후보 2곳으로 투표를 열었어요"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /2명 중 1명 투표했어요 · 누가 어디를 골랐는지는 보이지 않아요/,
      ),
    ).toBeTruthy();
    const radios = await screen.findAllByRole("radio");
    fireEvent.click(radios[1]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(api.vote).toHaveBeenCalledWith(CODE, 11));
    expect(
      await screen.findByText("투표가 마감돼서 고른 곳을 바꾸지 못했어요"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(radios[1].getAttribute("aria-checked")).toBe("false"),
    );
  });

  it.each([
    ["열려 있으면", OPEN_POLL],
    [
      "동점으로 닫혀 모임장을 기다리는 동안에도",
      { ...OPEN_POLL, state: "CLOSED" as const, tie: true, tieVotes: 1 },
    ],
  ])("투표가 %s 5초마다 스냅숏을 다시 받는다", async (_, poll) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.fetchSnapshot.mockResolvedValue(
        resultSnapshot({ phase: "VOTING", allowed: ["EDIT_TASTE"], poll }),
      );
      api.fetchResult.mockResolvedValue(RESULT);
      mount();
      expect(await screen.findByText("익명 투표예요")).toBeTruthy();
      const before = api.fetchSnapshot.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      await waitFor(() =>
        expect(api.fetchSnapshot.mock.calls.length).toBeGreaterThan(before),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("다른 브라우저로 고른 익명 투표 참여자에게는 투표했다는 것만 보인다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      resultSnapshot({
        phase: "VOTING",
        allowed: ["EDIT_TASTE", "VOTE"],
        poll: { ...OPEN_POLL, hasVoted: true },
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    expect(
      await screen.findByText(/하린님은 이미 투표했어요. 익명이라 고른 곳은/),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("radio")
        .every((radio) => radio.getAttribute("aria-checked") === "false"),
    ).toBe(true);
  });

  it("이름이 보이는 투표는 고른 사람과 아직 투표하지 않은 사람을 보이고, 마감 전에 한 번 묻는다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "VOTING",
        allowed: ["EDIT_DATE", "REMOVE_PROFILE", "CLOSE_POLL", "VOTE"],
        calculation: SUCCEEDED,
        resultCalculationId: 5,
        poll: {
          ...OPEN_POLL,
          anonymous: false,
          candidates: [
            { placeId: 10, votes: 1, voters: [1] },
            { placeId: 11, votes: 0, voters: [] },
          ],
          notVoted: [2],
          myVote: 10,
          hasVoted: true,
        },
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    api.closePoll.mockResolvedValue(undefined);
    mount();
    expect(await screen.findByText("이름이 보이는 투표예요")).toBeTruthy();
    expect(screen.getByText("아직 하린님이 투표하지 않았어요.")).toBeTruthy();
    expect(screen.getByText("내가 고른 곳")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "투표 마감" }));
    expect(
      await screen.findByText("아직 1명이 투표하지 않았어요"),
    ).toBeTruthy();
    expect(
      screen.getByText("지금 마감하면 하린님은 투표할 수 없어요."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "마감하기" }));
    await waitFor(() => expect(api.closePoll).toHaveBeenCalledWith(CODE));
  });

  it("동점으로 닫히면 모임장에게 한 곳을 고르는 시트가 열리고, 투표를 계속할 수도 있다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "VOTING",
        allowed: ["EDIT_DATE", "REMOVE_PROFILE", "DECIDE", "REOPEN_POLL"],
        calculation: SUCCEEDED,
        resultCalculationId: 5,
        poll: {
          ...OPEN_POLL,
          state: "CLOSED",
          tie: true,
          tieVotes: 1,
          reopenable: true,
          candidates: [
            { placeId: 10, votes: 1 },
            { placeId: 11, votes: 1 },
          ],
          votedCount: 2,
          notVotedCount: 0,
        },
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    api.decide.mockResolvedValue(undefined);
    api.reopenPoll.mockResolvedValue(undefined);
    mount();
    expect(await screen.findByText("2곳이 1표로 동점이에요")).toBeTruthy();
    fireEvent.click(await screen.findByRole("radio", { name: "연기 한 점" }));
    fireEvent.click(screen.getByRole("button", { name: "여기로 정하기" }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith(CODE, 11));
    fireEvent.click(screen.getByRole("button", { name: "투표 계속하기" }));
    await waitFor(() => expect(api.reopenPoll).toHaveBeenCalledWith(CODE));
  });

  it("동점으로 닫힌 동안 참여자는 모임장이 고르기를 기다린다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      resultSnapshot({
        phase: "VOTING",
        allowed: ["EDIT_TASTE"],
        poll: {
          ...OPEN_POLL,
          state: "CLOSED",
          tie: true,
          tieVotes: 1,
          reopenable: true,
          candidates: [
            { placeId: 10, votes: 1 },
            { placeId: 11, votes: 1 },
          ],
        },
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    expect(
      await screen.findByText(
        "2곳이 1표로 동점이에요. 민지님이 고르면 정해져요.",
      ),
    ).toBeTruthy();
  });

  it("투표 중에 추천 결과 보기로 결과 화면을 열고, 투표 화면으로 돌아온다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "VOTING",
        allowed: ["EDIT_DATE", "CLOSE_POLL", "VOTE"],
        calculation: SUCCEEDED,
        resultCalculationId: 5,
        poll: OPEN_POLL,
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "추천 결과 보기" }),
    );
    expect(
      await screen.findByText(/투표 중이에요 · 1명 투표했어요/),
    ).toBeTruthy();
    expect(screen.getAllByText("투표 후보")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "모임 정보 수정" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "투표 화면으로" }));
    expect(await screen.findByText("익명 투표예요")).toBeTruthy();
  });

  it("프로필 없이 보면 표 수는 보이고 투표하려면 이름을 고르라고 안내한다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      snapshot({ phase: "VOTING", poll: OPEN_POLL, resultCalculationId: 5 }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "결과만 보기" }));
    expect(
      await screen.findByText("투표하려면 내 이름을 골라 주세요."),
    ).toBeTruthy();
    expect(screen.getByText("1표")).toBeTruthy();
    expect(screen.getByRole("button", { name: "내 이름 고르기" })).toBeTruthy();
  });

  it("정한 곳은 결과 맨 위에 보이고, 모임장은 바꾸거나 취소한다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      hostSnapshot({
        phase: "DECIDED",
        allowed: ["CHANGE_DECISION", "CANCEL_DECISION", "EDIT_DATE"],
        calculation: SUCCEEDED,
        resultCalculationId: 5,
        poll: { ...OPEN_POLL, state: "CLOSED", tie: true, tieVotes: 2 },
        decision: { placeId: 10, method: "PICK", tieVotes: 2 },
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    api.cancelDecision.mockResolvedValue(undefined);
    api.decide.mockResolvedValue(undefined);
    mount();
    expect(
      await screen.findByText("2표씩 동점이라 민지님이 골랐어요"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "숯불 마당에서 만나요. 모임 당일부터 방문 평가를 남길 수 있어요.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("11월 14일 (토) 저녁 7시")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "다른 곳으로 바꾸기" }));
    fireEvent.click(await screen.findByRole("radio", { name: "연기 한 점" }));
    fireEvent.click(
      screen.getByRole("button", { name: "연기 한 점으로 바꾸기" }),
    );
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith(CODE, 11));

    fireEvent.click(screen.getByRole("button", { name: "정하기 취소" }));
    await waitFor(() => expect(api.cancelDecision).toHaveBeenCalledWith(CODE));
  });

  it("정한 곳이 있으면 내 취향을 고치기 전에 추천이 바뀌지 않는다고 알린다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      resultSnapshot({
        phase: "DECIDED",
        decision: { placeId: 10, method: "DIRECT" },
      }),
    );
    api.fetchResult.mockResolvedValue(RESULT);
    mount();
    expect(await screen.findByText("민지님이 정했어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "친구들 취향 보기" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "내 취향 수정" }),
    );
    expect(await screen.findByText("이미 정한 곳이 있어요")).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "수정하기" }));
    expect(mocks.push).toHaveBeenCalledWith(`/m/${CODE}/taste`);
  });
});

describe("회원 프로필로 바꾸기", () => {
  const convertible = () =>
    snapshot({
      me: {
        role: "PARTICIPANT",
        profileId: 2,
        signedIn: true,
        tasteReflected: false,
        convertible: true,
      },
      allowed: ["EDIT_TASTE", "LINK_ACCOUNT"],
    });

  it("로그인한 회원이 이 브라우저의 비회원 프로필로 들어오면 한 번 묻고, 바꾸면 알린다", async () => {
    window.localStorage.clear();
    api.fetchSnapshot.mockResolvedValue(convertible());
    api.linkAccount.mockResolvedValue(undefined);
    mount();
    expect(await screen.findByText("회원 프로필로 바꿀까요?")).toBeTruthy();
    expect(
      screen.getByText(/하린님 프로필을 지금 로그인한 계정으로/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    await waitFor(() => expect(api.linkAccount).toHaveBeenCalledWith(CODE));
    expect(await screen.findByText("회원 프로필로 바꿨어요")).toBeTruthy();
  });

  it("나중에를 누르면 이 모임에서는 다시 묻지 않는다", async () => {
    window.localStorage.clear();
    api.fetchSnapshot.mockResolvedValue(convertible());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "나중에" }));
    await waitFor(() =>
      expect(screen.queryByText("회원 프로필로 바꿀까요?")).toBeNull(),
    );

    cleanup();
    mount();
    expect(await screen.findByText("하린")).toBeTruthy();
    expect(screen.queryByText("회원 프로필로 바꿀까요?")).toBeNull();
    expect(api.linkAccount).not.toHaveBeenCalled();
  });
});
