// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MeetupSnapshot } from "@/domains/meetup/model/meetup";
import { ApiError } from "@/shared/api/api-error";

import { MeetupScreen } from "./meetup-screen";

const api = vi.hoisted(() => ({
  createMeetup: vi.fn(),
  searchAreas: vi.fn(),
  fetchSnapshot: vi.fn(),
}));
vi.mock("@/domains/meetup/api/meetup-api", () => api);

const CODE = "AbCdEfGhIjKlMnOpQrStUv";

function snapshot(info: Partial<MeetupSnapshot["info"]> = {}): MeetupSnapshot {
  return {
    phase: "WAITING",
    afterMeetup: false,
    info: {
      area: { kind: "STATION", name: "선릉" },
      category: "RESTAURANT",
      hostNickname: "민재",
      expiresOn: "2026-11-21",
      ...info,
    },
    questions: { mood: true, food: true, spicy: true, price: false },
    me: { role: "VIEWER", signedIn: false },
    allowed: ["JOIN"],
    profiles: [],
  };
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MeetupScreen code={CODE} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("모임 링크 화면", () => {
  it("모임 정보와 열 수 있는 마지막 날을 보인다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      snapshot({
        date: "2026-11-14",
        time: "19:00",
        headcount: 4,
        description: "편하게 얘기하면서 저녁 먹을 곳",
      }),
    );
    mount();
    expect(await screen.findByText("선릉역 모임")).toBeTruthy();
    expect(screen.getByText("11월 14일 (토) 저녁 7시")).toBeTruthy();
    expect(screen.getByText("4명")).toBeTruthy();
    expect(screen.getByText("편하게 얘기하면서 저녁 먹을 곳")).toBeTruthy();
    expect(screen.getByText("11월 21일까지 열 수 있어요")).toBeTruthy();
  });

  it("날짜가 없으면 날짜 미정이라고 보인다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    mount();
    expect(await screen.findByText("날짜 미정")).toBeTruthy();
  });

  it("없는 코드(404)면 모임 정보 없이 없는 링크 화면을 보인다", async () => {
    api.fetchSnapshot.mockRejectedValue(
      new ApiError("http", "not found", { status: 404 }),
    );
    mount();
    expect(await screen.findByText("없거나 끝난 모임이에요")).toBeTruthy();
    expect(screen.queryByText(/모임$/)).toBeNull();
    expect(api.fetchSnapshot).toHaveBeenCalledTimes(1);
  });
});
