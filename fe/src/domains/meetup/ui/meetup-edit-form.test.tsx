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

import { ApiError } from "@/shared/api/api-error";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import type { WithSession } from "../api/queries";
import type { MeetupSnapshot } from "../model/meetup";
import { MeetupEditForm } from "./meetup-edit-form";

const api = vi.hoisted(() => ({
  updateMeetup: vi.fn(),
  searchAreas: vi.fn(),
  fetchSnapshot: vi.fn(),
}));
vi.mock("../api/meetup-api", () => api);

const withSession: WithSession = (send) => send();
const NOON = new Date("2026-11-11T03:00:00Z");
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
      description: "회식",
      hostNickname: "민지",
    },
    questions: { mood: true, food: true, spicy: true, price: false },
    me: { role: "HOST", profileId: 1, signedIn: true },
    allowed: ["EDIT_INFO", "CALCULATE", "REMOVE_PROFILE", "EDIT_TASTE"],
    profiles: [],
    ...overrides,
  };
}

function mount(value: MeetupSnapshot) {
  const handlers = {
    onBack: vi.fn(),
    onSaved: vi.fn(),
    onUnauthorized: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MeetupEditForm
          code={CODE}
          snapshot={value}
          withSession={withSession}
          now={() => NOON}
          {...handlers}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("모임 정보 수정", () => {
  it("모든 항목을 지금 값으로 채우고, 고친 값을 빠진 것 없이 보낸다", async () => {
    api.updateMeetup.mockResolvedValue(undefined);
    const { onSaved } = mount(snapshot());

    expect(screen.queryByText(/열 수 있어요/)).toBeNull();
    expect(
      screen.getByRole("textbox", { name: /어떤 모임인가요/ }),
    ).toHaveProperty("value", "회식");
    fireEvent.click(screen.getByRole("button", { name: "카페" }));
    fireEvent.click(screen.getByRole("button", { name: "한 명 줄이기" }));
    fireEvent.change(screen.getByRole("textbox", { name: /어떤 모임인가요/ }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.updateMeetup).toHaveBeenCalledWith(CODE, {
      area: { kind: "STATION", name: "선릉" },
      category: "CAFE",
      headcount: 3,
      description: null,
    });
  });

  it("날짜를 바꾸면 날짜와 시각을 함께 보낸다", async () => {
    api.updateMeetup.mockResolvedValue(undefined);
    mount(snapshot());

    fireEvent.change(screen.getByLabelText("모임 날짜"), {
      target: { value: "2026-11-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(api.updateMeetup).toHaveBeenCalled());
    expect(api.updateMeetup.mock.calls[0][1]).toMatchObject({
      date: "2026-11-20",
      time: "19:00",
    });
  });

  it("날짜를 지우면 날짜와 시각을 비운다", async () => {
    api.updateMeetup.mockResolvedValue(undefined);
    mount(snapshot());

    fireEvent.click(screen.getByRole("button", { name: "날짜와 시간 지우기" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(api.updateMeetup).toHaveBeenCalled());
    expect(api.updateMeetup.mock.calls[0][1]).toMatchObject({
      date: null,
      time: null,
    });
  });

  it("추천 결과가 있으면 고친 내용은 다시 추천받아야 반영된다고 알린다", () => {
    mount(snapshot({ phase: "RESULT", resultCalculationId: 5 }));
    expect(
      screen.getByText(
        "추천 결과가 있어요. 고친 내용은 다시 추천받으면 반영돼요.",
      ),
    ).toBeTruthy();
  });

  it("날짜·시간만 고칠 수 있으면 지역과 업종은 읽기만 하고 날짜·시각만 보낸다", async () => {
    api.updateMeetup.mockResolvedValue(undefined);
    mount(
      snapshot({
        phase: "VOTING",
        allowed: ["EDIT_DATE", "CLOSE_POLL", "REMOVE_PROFILE"],
      }),
    );

    expect(
      screen.getByText("투표가 열려 있어 날짜와 시간만 바꿀 수 있어요."),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /지역/ })).toBeNull();
    expect(screen.getByText("선릉역")).toBeTruthy();
    expect(screen.getByRole("button", { name: "카페" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByText(/몇 명이 모이나요/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "날짜와 시간 지우기" }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("모임 시각"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(api.updateMeetup).toHaveBeenCalledWith(CODE, {
        date: "2026-11-14",
        time: "18:00",
      }),
    );
  });

  it("지금 상태에서 못 고치는 항목이면(409 phase) 알린다", async () => {
    api.updateMeetup.mockRejectedValue(
      new ApiError("http", "conflict", {
        status: 409,
        problem: { status: 409, type: "urn:fitdining:meetup:phase" },
      }),
    );
    mount(snapshot());
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(
      await screen.findByText("지금은 날짜와 시간만 바꿀 수 있어요"),
    ).toBeTruthy();
  });
});
