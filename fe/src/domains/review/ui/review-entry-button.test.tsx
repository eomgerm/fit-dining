// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";
import { createQueryClient } from "@/shared/api/query-client";

import type { WithAccessToken } from "../api/queries";
import type { ReviewFormResponse } from "../model/review";
import { ReviewEntryButton } from "./review-entry-button";
import { clearVisitEntry, useVisitEntry } from "./visit-entry-store";

const api = vi.hoisted(() => ({
  fetchReviews: vi.fn(),
  fetchReviewForm: vi.fn(),
  createReview: vi.fn(),
}));
vi.mock("../api/review-api", () => api);

function form(reviewedDates: string[] = []): ReviewFormResponse {
  return {
    place: {
      name: "카페 온담",
      categoryGroup: "CAFE",
      station: "YEOKSAM",
      lat: 37.5,
      lng: 127.0,
    },
    visitDate: { min: "2026-09-21", max: "2026-10-21", default: "2026-10-21" },
    reviewedDates,
    tags: { good: [], bad: [] },
    limits: { descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1000000 },
    writable: true,
  };
}

const near = { latitude: 37.5, longitude: 127.0, accuracy: 20 };
const far = { latitude: 37.51, longitude: 127.0, accuracy: 20 };

// 다음 위치 요청의 결과. null이면 권한 거절이다
const getCurrentPosition = vi.fn();
function answerWith(...coords: (typeof near | null)[]) {
  for (const value of coords) {
    getCurrentPosition.mockImplementationOnce(
      (success: PositionCallback, failure: PositionErrorCallback) =>
        value
          ? success({ coords: value } as GeolocationPosition)
          : failure({ code: 1 } as GeolocationPositionError),
    );
  }
}

const withAccessToken: WithAccessToken = (send) => send("at");

// 앱과 같은 재시도 설정의 QueryClient로 그린다
function mount(props: { withAccessToken?: WithAccessToken } = {}) {
  const onEnter = vi.fn();
  const onSignIn = vi.fn();
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <ReviewEntryButton
        placeId={3}
        withAccessToken={props.withAccessToken ?? withAccessToken}
        onEnter={onEnter}
        onSignIn={onSignIn}
      />
    </QueryClientProvider>,
  );
  return { onEnter, onSignIn, unmount: view.unmount };
}

const signedOut: WithAccessToken = () =>
  Promise.reject(new ApiError("http", "x", { status: 401 }));

const entry = () => renderHook(() => useVisitEntry(3)).result.current;
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  api.fetchReviewForm.mockReset().mockResolvedValue(form());
  getCurrentPosition.mockReset();
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
});

afterEach(() => {
  cleanup();
  clearVisitEntry(3);
  vi.unstubAllGlobals();
});

describe("ReviewEntryButton", () => {
  it("근처면 바로 작성 화면으로 가고 방문 확인을 넘긴다", async () => {
    answerWith(near);
    const { onEnter } = mount();

    press("방문 평가 남기기");

    await waitFor(() => expect(onEnter).toHaveBeenCalledTimes(1));
    expect(entry()).toMatchObject({ verified: true, pickDate: false });
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({
      enableHighAccuracy: true,
      maximumAge: 0,
    });
  });

  it("오늘 이미 썼으면 7-E01을 띄우고, 다른 날 고르기로 방문일 시트를 열게 한다", async () => {
    api.fetchReviewForm.mockResolvedValue(form(["2026-10-21"]));
    answerWith(near);
    const { onEnter } = mount();

    press("방문 평가 남기기");
    await screen.findByText("오늘은 이미 리뷰를 남겼어요");
    expect(getCurrentPosition).not.toHaveBeenCalled();
    press("다른 날 고르기");

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(entry()).toMatchObject({ verified: false, pickDate: true });
  });

  it("7-E01의 닫기는 작성 화면으로 가지 않는다", async () => {
    api.fetchReviewForm.mockResolvedValue(form(["2026-10-21"]));
    answerWith(near);
    const { onEnter } = mount();

    press("방문 평가 남기기");
    await screen.findByText("오늘은 이미 리뷰를 남겼어요");
    press("닫기");

    expect(onEnter).not.toHaveBeenCalled();
    expect(entry()).toBeUndefined();
  });

  it("위치 권한을 거절하면 7-E02를 띄우고, 그냥 쓰기는 확인 없이 작성 화면으로 간다", async () => {
    answerWith(null);
    const { onEnter } = mount();

    press("방문 평가 남기기");
    await screen.findByText("근처에서 확인하지 못했어요");
    press("그냥 쓰기");

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(entry()).toMatchObject({ verified: false, pickDate: false });
  });

  it("7-E02의 다시 확인은 위치만 다시 받아 근처면 작성 화면으로 간다", async () => {
    answerWith(far, near);
    const { onEnter } = mount();

    press("방문 평가 남기기");
    await screen.findByText("근처에서 확인하지 못했어요");
    press("다시 확인");

    await waitFor(() => expect(onEnter).toHaveBeenCalledTimes(1));
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(api.fetchReviewForm).toHaveBeenCalledTimes(1);
    expect(entry()).toMatchObject({ verified: true });
  });

  it("로그인하지 않았으면 위치를 묻지 않고 작성 화면 대신 로그인 안내를 띄운다(6-E05)", async () => {
    const { onEnter, onSignIn } = mount({ withAccessToken: signedOut });

    press("방문 평가 남기기");

    expect(await screen.findByText("로그인이 필요해요")).toBeTruthy();
    expect(
      screen.getByText("방문 평가는 로그인해야 이용할 수 있어요."),
    ).toBeTruthy();
    expect(onEnter).not.toHaveBeenCalled();
    expect(onSignIn).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("로그인 안내의 로그인은 창을 닫고 로그인으로 보낸다", async () => {
    const { onEnter, onSignIn } = mount({ withAccessToken: signedOut });

    press("방문 평가 남기기");
    await screen.findByText("로그인이 필요해요");
    press("로그인");

    expect(onSignIn).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText("로그인이 필요해요")).toBeNull(),
    );
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("로그인 안내의 취소는 장소 상세에 남는다", async () => {
    const { onEnter, onSignIn } = mount({ withAccessToken: signedOut });

    press("방문 평가 남기기");
    await screen.findByText("로그인이 필요해요");
    press("취소");

    await waitFor(() =>
      expect(screen.queryByText("로그인이 필요해요")).toBeNull(),
    );
    expect(onEnter).not.toHaveBeenCalled();
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("작성 화면 데이터를 받지 못하면 다시 시도하지 않고, 위치도 묻지 않은 채 작성 화면으로 보낸다", async () => {
    api.fetchReviewForm.mockRejectedValue(
      new ApiError("http", "x", { status: 503 }),
    );
    const { onEnter } = mount();

    press("방문 평가 남기기");

    await waitFor(() => expect(onEnter).toHaveBeenCalledTimes(1));
    expect(api.fetchReviewForm).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("확인하는 동안 상세를 떠나면 결과가 나와도 작성 화면으로 가지 않는다", async () => {
    let answer: PositionCallback | undefined;
    getCurrentPosition.mockImplementationOnce((success: PositionCallback) => {
      answer = success;
    });
    const { onEnter, unmount } = mount();

    press("방문 평가 남기기");
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
    unmount();
    await act(async () => answer?.({ coords: near } as GeolocationPosition));

    expect(onEnter).not.toHaveBeenCalled();
    expect(entry()).toBeUndefined();
  });

  it("위치 권한 창에 답하지 않아도 마감 시간이 지나면 7-E02를 띄운다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getCurrentPosition.mockImplementationOnce(() => {});
    mount();

    press("방문 평가 남기기");
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
    await act(() => vi.advanceTimersByTimeAsync(20_000));

    expect(screen.getByText("근처에서 확인하지 못했어요")).toBeTruthy();
    vi.useRealTimers();
  });

  describe("대기 창(D-53)", () => {
    // 위치 요청에 바로 답하지 않고, 돌려준 함수로 나중에 답한다
    function holdAnswer() {
      let answer: ((value: typeof near | null) => void) | undefined;
      getCurrentPosition.mockImplementationOnce(
        (success: PositionCallback, failure: PositionErrorCallback) => {
          answer = (value) =>
            value
              ? success({ coords: value } as GeolocationPosition)
              : failure({ code: 1 } as GeolocationPositionError);
        },
      );
      return (value: typeof near | null) => act(async () => answer?.(value));
    }

    // 화면 낭독기용 상태 문구에도 같은 글이 있어 창 제목만 찾는다
    const waitingTitle = () =>
      screen.queryByRole("heading", { name: "방문을 확인하고 있어요" });

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
      delete (Element.prototype as Partial<Element>).getAnimations;
    });

    async function pressAndWait(seconds: number) {
      press("방문 평가 남기기");
      await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
      await act(() => vi.advanceTimersByTimeAsync(seconds * 1000));
    }

    it("확인하는 동안 버튼이 바쁨 상태가 되고, 3초 안에 결과가 나오면 대기 창을 띄우지 않는다", async () => {
      const answer = holdAnswer();
      const { onEnter } = mount();

      await pressAndWait(2);
      const button = screen.getByRole("button", { name: "방문 확인 중" });
      expect(button.getAttribute("aria-busy")).toBe("true");
      await answer(near);
      await act(() => vi.advanceTimersByTimeAsync(3000));

      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(waitingTitle()).toBeNull();
    });

    it("3초가 지나면 대기 창을 띄우고, 확인에 실패하면 같은 창을 7-E02로 바꾼다", async () => {
      const answer = holdAnswer();
      mount();

      await pressAndWait(3);
      expect(waitingTitle()).toBeTruthy();
      const busy = screen.getByRole("button", { name: "확인 중" });
      expect(busy.getAttribute("aria-disabled")).toBe("true");
      expect(screen.getByRole("button", { name: "그냥 쓰기" })).toBeTruthy();
      await answer(far);

      expect(screen.getByText("근처에서 확인하지 못했어요")).toBeTruthy();
      expect(waitingTitle()).toBeNull();
      expect(screen.getByRole("button", { name: "다시 확인" })).toBe(busy);
    });

    it("대기 창의 그냥 쓰기는 확인을 멈추고 확인 없이 작성 화면으로 가며, 늦게 온 위치는 쓰지 않는다", async () => {
      const answer = holdAnswer();
      const { onEnter } = mount();

      await pressAndWait(3);
      press("그냥 쓰기");
      await answer(near);

      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(entry()).toMatchObject({ verified: false, pickDate: false });
    });

    it("근처로 확인돼 대기 창이 닫히는 동안 7-E02 문구로 바뀌지 않는다", async () => {
      // 닫힘 애니메이션이 끝나지 않은 것처럼 해 닫히는 창을 남겨 둔다
      const finished = new Promise<never>(() => {});
      Element.prototype.getAnimations = () => [
        { finished } as unknown as Animation,
      ];
      const answer = holdAnswer();
      const { onEnter } = mount();

      await pressAndWait(3);
      await answer(near);

      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("alertdialog", { hidden: true })).toBeTruthy();
      expect(
        screen.queryByText("근처에서 확인하지 못했어요", { ignore: false }),
      ).toBeNull();
    });

    it("대기 창을 닫으면 확인을 멈추고 장소 상세에 남는다", async () => {
      const answer = holdAnswer();
      const { onEnter } = mount();

      await pressAndWait(3);
      fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
      await waitFor(() => expect(waitingTitle()).toBeNull());
      await answer(near);

      expect(onEnter).not.toHaveBeenCalled();
      expect(screen.queryByText("근처에서 확인하지 못했어요")).toBeNull();
      expect(
        screen
          .getByRole("button", { name: "방문 평가 남기기" })
          .getAttribute("aria-busy"),
      ).toBe("false");
    });

    it("7-E02의 다시 확인은 창을 닫지 않고 바로 대기 창으로 바꾼다", async () => {
      answerWith(far);
      const answer = holdAnswer();
      const { onEnter } = mount();

      press("방문 평가 남기기");
      await screen.findByText("근처에서 확인하지 못했어요");
      press("다시 확인");

      expect(waitingTitle()).toBeTruthy();
      await answer(near);
      await waitFor(() => expect(onEnter).toHaveBeenCalledTimes(1));
      expect(entry()).toMatchObject({ verified: true });
    });
  });
});
