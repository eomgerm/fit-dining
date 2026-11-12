// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MeetupSnapshot } from "../model/meetup";
import { WaitingView } from "./waiting-view";

function snapshot(overrides: Partial<MeetupSnapshot> = {}): MeetupSnapshot {
  return {
    phase: "WAITING",
    afterMeetup: false,
    info: {
      area: { kind: "STATION", name: "선릉" },
      category: "RESTAURANT",
      headcount: 4,
      hostNickname: "민지",
    },
    questions: { mood: true, food: true, spicy: true, price: false },
    me: { role: "HOST", profileId: 1, signedIn: true },
    allowed: ["EDIT_INFO", "REMOVE_PROFILE", "CALCULATE", "EDIT_TASTE"],
    profiles: [
      {
        id: 1,
        name: "민지",
        color: 0,
        member: true,
        host: true,
        taste: {
          mood: "QUIET",
          likeFoods: ["KOREAN", "WESTERN"],
          noSpicy: true,
        },
        reflected: false,
      },
      {
        id: 2,
        name: "도윤",
        color: 1,
        member: true,
        host: false,
        reflected: false,
      },
      {
        id: 3,
        name: "하린",
        color: 2,
        member: false,
        host: false,
        taste: { wantMenu: "곱창" },
        reflected: false,
      },
    ],
    pendingCount: 1,
    ...overrides,
  };
}

function mount(data: MeetupSnapshot) {
  const handlers = {
    onShare: vi.fn(),
    onCopy: vi.fn(),
    onEditTaste: vi.fn(),
    onRemoveProfile: vi.fn(),
  };
  render(<WaitingView snapshot={data} {...handlers} />);
  return handlers;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("대기 화면", () => {
  it("모임장은 링크 보내기 구역과 남긴 수/인원, 남지 않은 수를 본다", () => {
    const { onCopy, onShare } = mount(snapshot());
    expect(screen.getByRole("heading", { name: "선릉역 모임" })).toBeTruthy();
    expect(screen.queryByText(/열 수 있어요/)).toBeNull();
    expect(
      screen.getByRole("heading", { name: /취향을 남긴 친구 3\/4/ }),
    ).toBeTruthy();
    expect(screen.getByText("아직 1명이 취향을 남기지 않았어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /링크 복사/ }));
    fireEvent.click(screen.getByRole("button", { name: /모임 링크 보내기/ }));
    expect(onCopy).toHaveBeenCalled();
    expect(onShare).toHaveBeenCalled();
  });

  it("친구마다 배지와 취향 요약을 보이고, 내 줄에만 수정이 있다", () => {
    const { onEditTaste } = mount(snapshot());
    expect(screen.getByRole("img", { name: "모임장" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "회원" })).toBeTruthy();
    expect(
      screen.getByText("조용한 곳 · 한식·양식 · 매운 건 못 먹어요"),
    ).toBeTruthy();
    expect(screen.getByText("곱창")).toBeTruthy();
    expect(screen.getByText("모두 상관없어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내 취향 수정" }));
    expect(onEditTaste).toHaveBeenCalled();
    expect(
      screen.getAllByRole("button", { name: "내 취향 수정" }),
    ).toHaveLength(1);
  });

  it("모임장은 다른 사람 줄의 메뉴에서 묻고 지운다", async () => {
    const { onRemoveProfile } = mount(snapshot());
    expect(
      screen.queryByRole("button", { name: "민지 프로필 메뉴" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "하린 프로필 메뉴" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "프로필 지우기" }),
    );
    expect(await screen.findByText("'하린' 프로필을 지울까요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(onRemoveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3 }),
    );
  });

  it("참여자는 모임장이 추천받으면 본다는 안내를 보고, 링크 보내기만 아래에 있다", () => {
    mount(
      snapshot({
        me: { role: "PARTICIPANT", profileId: 3, signedIn: false },
        allowed: ["EDIT_TASTE"],
      }),
    );
    expect(
      screen.getByText("민지님이 추천받으면 여기서 같이 볼 수 있어요."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /링크 복사/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /프로필 메뉴/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "모임 링크 보내기" }),
    ).toBeTruthy();
  });

  it("인원을 정하지 않았거나 남긴 수가 더 많으면 남긴 수만 보인다", () => {
    mount(
      snapshot({
        info: { ...snapshot().info, headcount: 2 },
        pendingCount: undefined,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "취향을 남긴 친구 3" }),
    ).toBeTruthy();
  });
});
