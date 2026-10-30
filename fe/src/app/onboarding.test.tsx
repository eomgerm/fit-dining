// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeEntry } from "./home-entry";
import { rememberLoginReturn } from "./login-return";
import {
  ANSWERS_KEY,
  GUEST_KEY,
  readAnswers,
} from "@/domains/onboarding/model/storage";
const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));
const router = { push: mocks.push, replace: mocks.replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/domains/auth/api/auth-client", () => ({ restore: mocks.restore }));
vi.mock("@/domains/place/ui/search-screen", () => ({
  SearchScreen: () => <div>검색 홈</div>,
}));
// 북마크 인증은 use-bookmark-access 테스트가 아니라 장소 화면 테스트에서 본다
vi.mock("./use-bookmark-access", () => ({ useBookmarkAccess: () => ({}) }));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("로그인 복구 전에는 빈 바탕, 복구 후 홈을 보여준다", async () => {
  let resolve!: () => void;
  mocks.restore.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<HomeEntry />);
  expect(screen.queryByText("검색 홈")).toBeNull();
  expect(screen.queryByRole("button", { name: "시작하기" })).toBeNull();
  await act(async () => resolve());
  expect(screen.getByText("검색 홈")).toBeTruthy();
});
it("비회원 표시가 있으면 복구 실패에도 홈을 보여준다", async () => {
  localStorage.setItem(GUEST_KEY, "1");
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<HomeEntry />);
  expect(await screen.findByText("검색 홈")).toBeTruthy();
});
it("처음 방문은 온보딩 답변을 저장하고 가입으로 이동한다", async () => {
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<HomeEntry />);
  fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
  fireEvent.click(screen.getByRole("radio", { name: "조용하고 차분한 곳" }));
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  expect(mocks.push).toHaveBeenCalledWith("/signup");
  expect(readAnswers()).toEqual({
    mood: "QUIET",
    priorities: [],
    purposes: [],
    tastes: [],
  });
});
it("복구 3초 상한 이후 늦은 응답은 화면을 바꾸지 않는다", async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  mocks.restore.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<HomeEntry />);
  await act(async () => vi.advanceTimersByTimeAsync(2999));
  expect(screen.queryByRole("button", { name: "시작하기" })).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole("button", { name: "시작하기" })).toBeTruthy();
  await act(async () => resolve());
  expect(screen.queryByText("검색 홈")).toBeNull();
});

describe("북마크 로그인 뒤 복귀", () => {
  const RETURN_KEY = "fitdining:login-return";

  it("로그인된 상태로 쿼리 없는 홈에 오면 남은 상세 주소로 한 번 replace하고 지운다", async () => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/place?id=3&from=saved");
    render(<HomeEntry />);

    await vi.waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/place?id=3&from=saved"),
    );
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
    // 다른 화면으로 가므로 홈을 그리지 않는다
    expect(screen.queryByText("검색 홈")).toBeNull();
  });

  it("저장한 장소 화면 주소면 replace하고 메인을 그린다", async () => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/?view=saved&category=CAFE");
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).toHaveBeenCalledWith("/?view=saved&category=CAFE");
  });

  it("로그인 없이 홈에 오면 주소를 버린다", async () => {
    localStorage.setItem(GUEST_KEY, "1");
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    rememberLoginReturn("/place?id=3");
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it("남긴 지 10분이 지났으면 따르지 않는다", async () => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/place?id=3", Date.now() - 10 * 60 * 1000 - 1);
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each([
    "//evil.example/x",
    "/\\evil.example/x",
    "https://evil.example/x",
    "place?id=3",
  ])("다른 출처로 해석되는 %s는 따르지 않는다", async (path) => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn(path);
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it("쿼리가 있는 홈에 오면 남은 주소를 읽지 않는다", async () => {
    window.history.replaceState(null, "", "/?view=saved");
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/place?id=3");
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).not.toBeNull();
  });

  it("로그인 복원이 3초 안에 끝나지 않으면 주소를 버린다", async () => {
    vi.useFakeTimers();
    mocks.restore.mockImplementation(() => new Promise(() => {}));
    rememberLoginReturn("/place?id=3");
    render(<HomeEntry />);

    await act(async () => vi.advanceTimersByTimeAsync(3000));

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });
});

it("선택 없이 건너뛰면 답변을 저장하지 않고 가입으로 이동한다", async () => {
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<HomeEntry />);
  fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  expect(mocks.push).toHaveBeenCalledWith("/signup");
  expect(readAnswers()).toBeUndefined();
  expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
});
