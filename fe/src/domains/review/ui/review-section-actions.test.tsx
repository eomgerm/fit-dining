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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import {
  reviewKeys,
  type WithAccessToken,
  type WithOptionalAccessToken,
} from "../api/queries";
import type {
  ReviewFormResponse,
  ReviewItem,
  ReviewListResponse,
} from "../model/review";
import { ReviewSection } from "./review-section";

const api = vi.hoisted(() => ({
  fetchReviews: vi.fn(),
  deleteReview: vi.fn(),
  reportReview: vi.fn(),
}));
vi.mock("../api/review-api", () => api);

const mine: ReviewItem = {
  reviewId: 2,
  createdAt: "2026-10-20T15:00:00+09:00",
  visitedAt: "2026-10-12",
  nickname: "라테한잔",
  revisitIntent: false,
  tags: [],
  description: "내가 쓴 리뷰",
  photos: [],
  mine: true,
};

const others: ReviewItem = {
  ...mine,
  reviewId: 1,
  nickname: "밤산책",
  description: "남이 쓴 리뷰",
  mine: false,
};

const page = (items: ReviewItem[]): ReviewListResponse => ({
  totalCount: items.length,
  items,
});

const signedIn: WithOptionalAccessToken = (send) => send("token");
const withAccessToken: WithAccessToken = (send) => send("token");
const http = (status: number) => new ApiError("http", "", { status });

function mount(accessToken: WithAccessToken = withAccessToken) {
  const onEdit = vi.fn();
  const onSignIn = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ReviewSection
          placeId={3}
          withOptionalAccessToken={signedIn}
          withAccessToken={accessToken}
          onEdit={onEdit}
          onSignIn={onSignIn}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onEdit, onSignIn, client };
}

const menuButtons = () => screen.getAllByRole("button", { name: /리뷰 메뉴$/ });

async function openDelete() {
  fireEvent.click(
    await screen.findByRole("button", { name: "10월 12일 방문 리뷰 메뉴" }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "삭제하기" }));
  await screen.findByText("리뷰를 삭제할까요?");
}

const confirmButton = () => screen.getByRole("button", { name: "삭제" });

beforeEach(() => {
  api.fetchReviews.mockReset().mockResolvedValue(page([mine, others]));
  api.deleteReview.mockReset();
  api.reportReview.mockReset();
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("ReviewSection 내 리뷰 메뉴", () => {
  it("내 리뷰의 ⋯ 메뉴는 방문일로 구분되고, 수정하기는 그 리뷰 id로 수정 화면을 연다", async () => {
    const { onEdit } = mount();

    fireEvent.click(
      await screen.findByRole("button", { name: "10월 12일 방문 리뷰 메뉴" }),
    );
    expect(menuButtons()).toHaveLength(2);
    fireEvent.click(await screen.findByRole("menuitem", { name: "수정하기" }));

    expect(onEdit).toHaveBeenCalledWith(2);
  });

  it("삭제를 확인하면 지우고 목록을 다시 받은 뒤 창을 닫고 토스트를 띄운다(6-08, 6-09)", async () => {
    let finish: () => void = () => {};
    api.deleteReview.mockReturnValue(
      new Promise<void>((resolve) => (finish = resolve)),
    );
    const { client } = mount();
    client.setQueryData<Partial<ReviewFormResponse>>(reviewKeys.form(3), {});

    await openDelete();
    fireEvent.click(confirmButton());

    // 지우는 동안: 두 버튼은 막히지만 포커스는 남고, Esc로도 닫히지 않는다
    const pending = screen.getByRole("button", { name: "삭제하는 중" });
    expect(pending.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "취소" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.getByText("리뷰를 삭제하고 있어요")).toBeTruthy();
    fireEvent.keyDown(pending, { key: "Escape" });
    expect(screen.getByText("리뷰를 삭제할까요?")).toBeTruthy();

    api.fetchReviews.mockResolvedValue(page([others]));
    finish();

    expect(await screen.findByText("리뷰를 삭제했어요")).toBeTruthy();
    expect(api.deleteReview).toHaveBeenCalledWith(2, "token");
    expect(screen.queryByText("내가 쓴 리뷰")).toBeNull();
    expect(api.fetchReviews).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(reviewKeys.form(3))?.isInvalidated).toBe(true);
    await waitFor(() =>
      expect(screen.queryByText("리뷰를 삭제할까요?")).toBeNull(),
    );
  });

  it("지운 뒤 창이 닫히면 사라진 ⋯ 버튼 대신 리뷰 섹션으로 포커스를 보낸다", async () => {
    api.deleteReview.mockResolvedValue(undefined);
    mount();

    await openDelete();
    api.fetchReviews.mockResolvedValue(page([others]));
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("region", { name: "리뷰" }),
      ),
    );
  });

  it("취소하면 지우지 않는다", async () => {
    mount();

    await openDelete();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() =>
      expect(screen.queryByText("리뷰를 삭제할까요?")).toBeNull(),
    );
    expect(api.deleteReview).not.toHaveBeenCalled();
  });

  it("이미 지운 리뷰(404)면 알리고 목록을 다시 받는다", async () => {
    api.deleteReview.mockRejectedValue(http(404));
    mount();

    await openDelete();
    api.fetchReviews.mockResolvedValue(page([others]));
    fireEvent.click(confirmButton());

    expect(await screen.findByText("이미 삭제된 리뷰예요")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("내가 쓴 리뷰")).toBeNull());
  });

  it("응답이 시간 초과면 알리고, 서버가 지웠을 수 있어 목록을 다시 받는다", async () => {
    api.deleteReview.mockRejectedValue(new ApiError("timeout", ""));
    mount();

    await openDelete();
    api.fetchReviews.mockResolvedValue(page([others]));
    fireEvent.click(confirmButton());

    expect(await screen.findByText("리뷰를 삭제하지 못했어요")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("내가 쓴 리뷰")).toBeNull());
  });

  it.each([
    [500, "리뷰를 삭제하지 못했어요"],
    [403, "리뷰를 삭제하지 못했어요"],
    [401, "로그인이 끝났어요. 다시 로그인해 주세요"],
  ])("%s면 알리고 리뷰는 목록에 남는다", async (status, message) => {
    api.deleteReview.mockRejectedValue(http(status));
    mount();

    await openDelete();
    fireEvent.click(confirmButton());

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText("내가 쓴 리뷰")).toBeTruthy();
    expect(api.fetchReviews).toHaveBeenCalledTimes(1);
  });

  it("오프라인이면 기다리지 않고 바로 실패를 알린다", async () => {
    api.deleteReview.mockRejectedValue(new ApiError("network", ""));
    mount();

    await openDelete();
    onlineManager.setOnline(false);
    fireEvent.click(confirmButton());

    expect(
      await screen.findByText("인터넷에 연결되어 있지 않아요"),
    ).toBeTruthy();
    expect(api.deleteReview).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText("리뷰를 삭제할까요?")).toBeNull(),
    );
  });
});

describe("ReviewSection 남의 리뷰 신고", () => {
  async function openOthersMenu() {
    fireEvent.click(
      await screen.findByRole("button", {
        name: "밤산책의 10월 12일 방문 리뷰 메뉴",
      }),
    );
  }

  async function openReport() {
    await openOthersMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "신고하기" }));
    await screen.findByRole("dialog", { name: "신고 사유를 선택하세요" });
  }

  const submitButton = () => screen.getByRole("button", { name: "신고하기" });
  const sheet = () =>
    screen.queryByRole("dialog", { name: "신고 사유를 선택하세요" });

  it("남의 리뷰 ⋯ 메뉴에는 신고하기만 있다(6-10)", async () => {
    mount();

    await openOthersMenu();

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["신고하기"]);
  });

  async function openSignIn() {
    await openOthersMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "신고하기" }));
    await screen.findByText("로그인이 필요해요");
  }

  const signInPrompt = () => screen.queryByText("로그인이 필요해요");

  it("로그인하지 않았으면 시트 대신 로그인 안내를 띄운다(6-E05, PRD FR-12)", async () => {
    const { onSignIn } = mount(() => Promise.reject(http(401)));

    await openSignIn();

    expect(
      screen.getByText("리뷰 신고는 로그인해야 이용할 수 있어요."),
    ).toBeTruthy();
    expect(sheet()).toBeNull();
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("로그인 안내의 로그인은 창을 닫고 로그인으로 보낸다", async () => {
    const { onSignIn } = mount(() => Promise.reject(http(401)));

    await openSignIn();
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(signInPrompt()).toBeNull());
    expect(sheet()).toBeNull();
  });

  it("로그인 안내의 취소는 창만 닫는다", async () => {
    const { onSignIn } = mount(() => Promise.reject(http(401)));

    await openSignIn();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() => expect(signInPrompt()).toBeNull());
    expect(onSignIn).not.toHaveBeenCalled();
    expect(sheet()).toBeNull();
  });

  it("사유를 고르기 전에는 보낼 수 없고, 고르면 보낸 뒤 시트를 닫고 토스트를 띄운다(6-11, 6-12)", async () => {
    api.reportReview.mockResolvedValue(undefined);
    mount();

    await openReport();
    expect(submitButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "광고·도배" }));
    expect(screen.queryByRole("textbox", { name: "신고 설명" })).toBeNull();
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("신고했어요. 확인 후 처리할게요."),
    ).toBeTruthy();
    expect(api.reportReview).toHaveBeenCalledWith(
      1,
      { reason: "AD_SPAM" },
      "token",
    );
    await waitFor(() => expect(sheet()).toBeNull());
    expect(api.fetchReviews).toHaveBeenCalledTimes(1);
  });

  it("기타를 고를 때만 설명칸이 나오고 설명을 함께 보낸다", async () => {
    api.reportReview.mockResolvedValue(undefined);
    mount();

    await openReport();
    fireEvent.click(screen.getByRole("radio", { name: "기타" }));
    fireEvent.change(screen.getByRole("textbox", { name: "신고 설명" }), {
      target: { value: "가게와 상관없는 홍보예요" },
    });
    expect(screen.getByText("13/100")).toBeTruthy();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(api.reportReview).toHaveBeenCalledWith(
        1,
        { reason: "OTHER", detail: "가게와 상관없는 홍보예요" },
        "token",
      ),
    );
  });

  it("이미 신고한 리뷰(409)면 알리고 시트를 닫는다", async () => {
    api.reportReview.mockRejectedValue(http(409));
    mount();

    await openReport();
    fireEvent.click(screen.getByRole("radio", { name: "욕설·혐오·음란물" }));
    fireEvent.click(submitButton());

    expect(await screen.findByText("이미 신고한 리뷰예요")).toBeTruthy();
    await waitFor(() => expect(sheet()).toBeNull());
  });

  it("이미 지운 리뷰(404)면 알리고 목록을 다시 받는다", async () => {
    api.reportReview.mockRejectedValue(http(404));
    mount();

    await openReport();
    api.fetchReviews.mockResolvedValue(page([mine]));
    fireEvent.click(screen.getByRole("radio", { name: "장소와 무관한 내용" }));
    fireEvent.click(submitButton());

    expect(await screen.findByText("이미 삭제된 리뷰예요")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("남이 쓴 리뷰")).toBeNull());
  });

  it("이미 지운 리뷰(404)면 시트가 닫힐 때 빠진 ⋯ 버튼 대신 리뷰 섹션으로 포커스를 보낸다", async () => {
    api.reportReview.mockRejectedValue(http(404));
    mount();

    await openReport();
    api.fetchReviews.mockResolvedValue(page([mine]));
    fireEvent.click(screen.getByRole("radio", { name: "광고·도배" }));
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("region", { name: "리뷰" }),
      ),
    );
  });

  it("연결이 끊겼으면 알리고 시트를 둬 다시 보낼 수 있다(6-E06)", async () => {
    api.reportReview.mockRejectedValueOnce(new ApiError("network", ""));
    api.reportReview.mockResolvedValueOnce(undefined);
    mount();

    await openReport();
    fireEvent.click(screen.getByRole("radio", { name: "광고·도배" }));
    onlineManager.setOnline(false);
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("인터넷에 연결되어 있지 않아요"),
    ).toBeTruthy();
    expect(sheet()).not.toBeNull();
    onlineManager.setOnline(true);
    await waitFor(() =>
      expect(submitButton().getAttribute("aria-disabled")).not.toBe("true"),
    );
    fireEvent.click(submitButton());
    expect(
      await screen.findByText("신고했어요. 확인 후 처리할게요."),
    ).toBeTruthy();
  });
});
