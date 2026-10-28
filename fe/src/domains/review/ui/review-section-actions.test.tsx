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

function mount() {
  const onEdit = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ReviewSection
          placeId={3}
          withOptionalAccessToken={signedIn}
          withAccessToken={withAccessToken}
          onEdit={onEdit}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onEdit, client };
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
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("ReviewSection 내 리뷰 메뉴", () => {
  it("내 리뷰에만 방문일로 구분되는 ⋯ 메뉴가 있고, 수정하기는 그 리뷰 id로 수정 화면을 연다", async () => {
    const { onEdit } = mount();

    fireEvent.click(
      await screen.findByRole("button", { name: "10월 12일 방문 리뷰 메뉴" }),
    );
    expect(menuButtons()).toHaveLength(1);
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
