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
