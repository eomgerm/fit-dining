// @vitest-environment jsdom
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveDraft, EMPTY_JOIN_FORM } from "@/domains/meetup/model/join-form";
import { isJustJoined } from "@/domains/meetup/model/just-joined";
import type { MeetupSnapshot } from "@/domains/meetup/model/meetup";
import { ApiError } from "@/shared/api/api-error";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { JoinScreen } from "./join-screen";

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
vi.mock("../../../login-return", () => ({
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
      hostNickname: "모임장민재닉네임긴것",
    },
    questions: { mood: true, food: true, spicy: true, price: false },
    me: { role: "VIEWER", signedIn: false },
    allowed: ["JOIN"],
    profiles: [],
    ...overrides,
  };
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <JoinScreen code={CODE} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function fillName(name: string) {
  fireEvent.change(await screen.findByLabelText(/이름/), {
    target: { value: name },
  });
}

const submit = () => screen.getByRole("button", { name: "취향 남기기" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("질문지 화면", () => {
  it("남기면 이름과 취향을 보내고 모임 링크로 돌아가 취향을 남겼어요를 보인다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    api.createProfile.mockResolvedValue({ profileId: 5 });
    mount();
    await fillName(" 하린 ");
    fireEvent.click(screen.getByRole("radio", { name: /활기찬 곳/ }));
    fireEvent.click(submit());

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(`/m/${CODE}`),
    );
    expect(api.createProfile).toHaveBeenCalledWith(CODE, {
      name: "하린",
      taste: { mood: "LIVELY" },
    });
    expect(isJustJoined(CODE)).toBe(true);
  });

  it("이미 있는 이름이면(409) 이름 칸 아래에 알리고 입력이 남는다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    api.createProfile.mockRejectedValue(
      new ApiError("http", "conflict", {
        status: 409,
        problem: { status: 409, type: "urn:fitdining:meetup:name-taken" },
      }),
    );
    mount();
    await fillName("하린");
    fireEvent.click(submit());
    expect(
      await screen.findByText(/'하린'은 이미 있는 이름이에요/),
    ).toBeTruthy();
    expect((screen.getByLabelText(/이름/) as HTMLInputElement).value).toBe(
      "하린",
    );
  });

  it("다 찼으면(409) 다 찬 모임 화면을 보인다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    api.createProfile.mockRejectedValue(
      new ApiError("http", "conflict", {
        status: 409,
        problem: { status: 409, type: "urn:fitdining:meetup:full" },
      }),
    );
    mount();
    await fillName("하린");
    fireEvent.click(submit());
    expect(await screen.findByText("모임 인원이 다 찼어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내 이름 고르기" }));
    expect(mocks.push).toHaveBeenCalledWith(`/m/${CODE}/profiles`);
  });

  it("로그인하러 가면 쓰던 답을 두고, 돌아오면 채운다", async () => {
    api.fetchSnapshot.mockResolvedValue(snapshot());
    mount();
    await fillName("하린");
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(mocks.rememberLoginReturn).toHaveBeenCalledWith(`/m/${CODE}/join`);
    expect(mocks.push).toHaveBeenCalledWith("/login");
    cleanup();

    mount();
    expect(
      ((await screen.findByLabelText(/이름/)) as HTMLInputElement).value,
    ).toBe("하린");
  });

  it("모임장은 닉네임 앞 10자를 이름에 채워 둔다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      snapshot({ me: { role: "HOST", signedIn: true } }),
    );
    saveDraft("other", EMPTY_JOIN_FORM);
    mount();
    expect(
      ((await screen.findByLabelText(/이름/)) as HTMLInputElement).value,
    ).toBe("모임장민재닉네임긴것".slice(0, 10));
  });

  it("이미 프로필이 있으면 모임 링크로 돌려보낸다", async () => {
    api.fetchSnapshot.mockResolvedValue(
      snapshot({ me: { role: "PARTICIPANT", profileId: 3, signedIn: false } }),
    );
    mount();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(`/m/${CODE}`),
    );
  });
});

describe("질문지를 열지 못할 때", () => {
  function mountWithoutRetryDelay() {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
        }
      >
        <ToastProvider>
          <JoinScreen code={CODE} />
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
    onlineManager.setOnline(true);
  });

  it("모임을 받지 못하면 실패 안내와 다시 시도, 모임 링크로 가는 뒤로를 보인다", async () => {
    api.fetchSnapshot.mockRejectedValue(
      new ApiError("http", "server", { status: 500 }),
    );
    mountWithoutRetryDelay();
    expect(await screen.findByText("모임을 불러오지 못했어요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
    expect(mocks.replace).toHaveBeenCalledWith(`/m/${CODE}`);
  });

  it("연결이 끊겨 요청이 멈추면 연결 안내를 보인다", async () => {
    onlineManager.setOnline(false);
    api.fetchSnapshot.mockResolvedValue(snapshot());
    mountWithoutRetryDelay();
    expect(
      await screen.findByText("인터넷에 연결되어 있지 않아요"),
    ).toBeTruthy();
    expect(api.fetchSnapshot).not.toHaveBeenCalled();
  });
});
