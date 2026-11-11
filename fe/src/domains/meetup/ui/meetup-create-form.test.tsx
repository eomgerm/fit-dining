// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import type { WithSession } from "../api/queries";
import { MeetupCreateForm } from "./meetup-create-form";

const api = vi.hoisted(() => ({
  createMeetup: vi.fn(),
  searchAreas: vi.fn(),
  fetchSnapshot: vi.fn(),
}));
vi.mock("../api/meetup-api", () => api);

const withSession: WithSession = (send) => send();
const NOON = new Date("2026-11-11T03:00:00Z");

function mount(props: Partial<Parameters<typeof MeetupCreateForm>[0]> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onCreated: vi.fn(),
    onUnauthorized: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MeetupCreateForm
          withSession={withSession}
          now={() => NOON}
          {...handlers}
          {...props}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return handlers;
}

const submitButton = () =>
  screen.getByRole("button", { name: /내 취향 남기기|모임을 만드는 중/ });

async function pickSeolleung() {
  fireEvent.change(screen.getByRole("combobox", { name: /지역/ }), {
    target: { value: "선릉역" },
  });
  await waitFor(() => expect(submitButton()).toHaveProperty("disabled", false));
}

beforeEach(() => {
  api.searchAreas.mockImplementation(async (query: string) => ({
    items: "선릉역".includes(query) ? [{ kind: "STATION", name: "선릉" }] : [],
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("모임 만들기", () => {
  it("지역이 비어 있으면 다음 버튼이 눌리지 않고, 업종은 식당이 골라져 있다", () => {
    mount();
    expect(submitButton()).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "식당" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "카페" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("역 이름을 끝까지 넣으면 그 역을 고르고 다음 버튼이 눌린다", async () => {
    mount();
    await pickSeolleung();
    expect(api.searchAreas).toHaveBeenCalledWith("선릉역", expect.anything());
  });

  it("찾은 지역 목록에서 고를 수 있다", async () => {
    mount();
    const input = screen.getByRole("combobox", { name: /지역/ });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "선" } });
    const option = await screen.findByRole("option", { name: "선릉역" });
    fireEvent.mouseDown(option);
    expect(input).toHaveProperty("value", "선릉역");
    expect(submitButton()).toHaveProperty("disabled", false);
  });

  it("장소가 없는 지역이면 칸 아래에 알린다", async () => {
    mount();
    fireEvent.change(screen.getByRole("combobox", { name: /지역/ }), {
      target: { value: "강릉역" },
    });
    expect(
      await screen.findByText(/강릉역 근처에는 아직 장소가 없어요/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("combobox", { name: /지역/ })
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(submitButton()).toHaveProperty("disabled", true);
  });

  it("고른 항목만 보내고, 만들면 코드를 넘긴다", async () => {
    api.createMeetup.mockResolvedValue({ code: "AbCdEfGhIjKlMnOpQrStUv" });
    const { onCreated } = mount();
    await pickSeolleung();
    fireEvent.click(screen.getByRole("button", { name: "술집" }));
    fireEvent.click(screen.getByRole("button", { name: "한 명 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "한 명 늘리기" }));
    fireEvent.change(screen.getByLabelText("모임 날짜"), {
      target: { value: "2026-11-14" },
    });
    fireEvent.change(screen.getByLabelText("모임 시각"), {
      target: { value: "19:00" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /어떤 모임인가요/ }), {
      target: { value: " 회식 " },
    });
    expect(screen.getByText("3명")).toBeTruthy();
    expect(screen.getByText("11월 14일 (토)")).toBeTruthy();
    expect(screen.getByText("저녁 7:00")).toBeTruthy();

    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith("AbCdEfGhIjKlMnOpQrStUv"),
    );
    expect(api.createMeetup).toHaveBeenCalledWith({
      area: { kind: "STATION", name: "선릉" },
      category: "BAR",
      date: "2026-11-14",
      time: "19:00",
      headcount: 3,
      description: "회식",
    });
  });

  it("만드는 중에는 버튼이 눌리지 않고 진행을 보인다", async () => {
    api.createMeetup.mockReturnValue(new Promise(() => {}));
    mount();
    await pickSeolleung();
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "모임을 만드는 중" }),
      ).toHaveProperty("disabled", true),
    );
    fireEvent.click(submitButton());
    expect(api.createMeetup).toHaveBeenCalledTimes(1);
  });

  it("날짜가 없으면 시간을 고를 수 없고, 날짜를 지우면 시간도 지운다", async () => {
    mount();
    const time = screen.getByLabelText("모임 시각");
    expect(time).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("모임 날짜"), {
      target: { value: "2026-11-14" },
    });
    fireEvent.change(time, { target: { value: "19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "날짜 지우기" }));
    expect(screen.getByLabelText("모임 시각")).toHaveProperty("value", "");
    expect(screen.getByLabelText("모임 시각")).toHaveProperty("disabled", true);
  });

  it("오늘의 지난 시각을 고르면 알리고 보낼 수 없다", async () => {
    mount();
    await pickSeolleung();
    fireEvent.change(screen.getByLabelText("모임 날짜"), {
      target: { value: "2026-11-11" },
    });
    fireEvent.change(screen.getByLabelText("모임 시각"), {
      target: { value: "11:00" },
    });
    expect(screen.getByText(/지난 시각이에요/)).toBeTruthy();
    expect(submitButton()).toHaveProperty("disabled", true);
  });

  it("세션이 끝났으면(401) 로그인 안내를 부탁한다", async () => {
    api.createMeetup.mockRejectedValue(
      new ApiError("http", "unauthorized", { status: 401 }),
    );
    const { onUnauthorized } = mount();
    await pickSeolleung();
    fireEvent.click(submitButton());
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
  });
});
