// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomeEntry } from "./home-entry";
import { GUEST_KEY, readAnswers } from "@/domains/onboarding/model/storage";
const mocks = vi.hoisted(() => ({ restore: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/domains/auth/api/auth-client", () => ({ restore: mocks.restore }));
vi.mock("@/domains/place/ui/search-screen", () => ({
  SearchScreen: () => <div>검색 홈</div>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
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
