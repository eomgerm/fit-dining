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

import { reviewKeys, type WithAccessToken } from "../api/queries";
import type { ReviewDetailResponse, ReviewListResponse } from "../model/review";
import { ReviewEditForm } from "./review-edit-form";

const api = vi.hoisted(() => ({
  fetchReview: vi.fn(),
  updateReview: vi.fn(),
  fetchPhotoUploads: vi.fn(),
  putPhoto: vi.fn(),
}));
vi.mock("../api/review-api", () => api);

const review: ReviewDetailResponse = {
  reviewId: 12,
  placeId: 3,
  description: "처음 본문",
  photos: [],
  limits: { descriptionMax: 500, photoMax: 5 },
};

const withAccessToken: WithAccessToken = (send) => send("token");
const http = (status: number) => new ApiError("http", "", { status });

function mount() {
  const props = {
    onSuccess: vi.fn(),
    onClose: vi.fn(),
    onSignedOut: vi.fn(),
  };
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ReviewEditForm
          reviewId={12}
          withAccessToken={withAccessToken}
          {...props}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...props, client, ...view };
}

const textarea = () =>
  screen.findByRole("textbox", {
    name: "리뷰",
  }) as Promise<HTMLTextAreaElement>;
const submitButton = () => screen.getByRole("button", { name: "수정하기" });
const type = async (value: string) =>
  fireEvent.change(await textarea(), { target: { value } });

beforeEach(() => {
  api.fetchReview.mockReset().mockResolvedValue(review);
  api.updateReview.mockReset();
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

const withPhotos: ReviewDetailResponse = {
  ...review,
  photos: [
    {
      photoId: "p1",
      url: "/photos/dev/confirmed/p1.jpg",
      thumbUrl: "/photos/dev/confirmed/p1.thumb.jpg",
    },
    {
      photoId: "p2",
      url: "/photos/dev/confirmed/p2.jpg",
      thumbUrl: "/photos/dev/confirmed/p2.thumb.jpg",
    },
  ],
};

describe("ReviewEditForm 사진", () => {
  it("저장된 사진을 순서대로 보이고 장수를 센다", async () => {
    api.fetchReview.mockResolvedValue(withPhotos);
    mount();

    expect(await screen.findByRole("img", { name: "사진 1" })).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "사진 2" }).getAttribute("src"),
    ).toBe("/photos/dev/confirmed/p2.thumb.jpg");
    expect(
      screen.getByRole("button", { name: "사진 추가, 2/5장" }),
    ).toBeTruthy();
  });

  it("사진만 빼면 본문 없이 남은 사진 목록과 화면이 받은 사진 목록을 보낸다", async () => {
    api.fetchReview.mockResolvedValue(withPhotos);
    api.updateReview.mockResolvedValue(undefined);
    const { onSuccess } = mount();

    fireEvent.click(await screen.findByRole("button", { name: "사진 1 빼기" }));
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.updateReview).toHaveBeenCalledWith(
      12,
      { photos: ["p2"], basePhotos: ["p1", "p2"] },
      "token",
    );
  });

  it("본문만 고치면 사진은 보내지 않는다", async () => {
    api.fetchReview.mockResolvedValue(withPhotos);
    api.updateReview.mockResolvedValue(undefined);
    const { onSuccess } = mount();

    await type("고친 본문");
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.updateReview).toHaveBeenCalledWith(
      12,
      { description: "고친 본문" },
      "token",
    );
  });

  it("쓸 수 없는 사진(400)이면 사진 안내를 띄운다", async () => {
    api.fetchReview.mockResolvedValue(withPhotos);
    api.updateReview.mockRejectedValue(
      new ApiError("http", "", {
        status: 400,
        problem: { status: 400, type: "urn:fitdining:review:invalid-photo" },
      }),
    );
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "사진 2 빼기" }));
    fireEvent.click(submitButton());

    expect(await screen.findByText("올릴 수 없는 사진이 있어요")).toBeTruthy();
  });

  it("사진이 바뀌었으면(409) 다시 불러와 사진은 저장된 것으로 돌리고 본문은 남긴다", async () => {
    api.fetchReview
      .mockResolvedValueOnce(withPhotos)
      .mockResolvedValueOnce({ ...withPhotos, photos: [withPhotos.photos[1]] });
    api.updateReview.mockRejectedValue(http(409));
    mount();

    await type("고친 본문");
    fireEvent.click(await screen.findByRole("button", { name: "사진 1 빼기" }));
    fireEvent.click(submitButton());
    expect(await screen.findByText("사진이 바뀌었어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));

    expect(
      await screen.findByRole("button", { name: "사진 추가, 1/5장" }),
    ).toBeTruthy();
    expect(api.fetchReview).toHaveBeenCalledTimes(2);
    expect((await textarea()).value).toBe("고친 본문");
  });
});

describe("ReviewEditForm", () => {
  it("불러오는 동안 빈 틀에 불러오는 중이라고 알린다", () => {
    api.fetchReview.mockReturnValue(new Promise(() => {}));
    mount();

    expect(screen.getByText("리뷰를 불러오는 중이에요")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("저장된 본문으로 시작하고, 바뀐 것이 없으면 수정하기가 비활성이다(6-07)", async () => {
    mount();

    expect((await textarea()).value).toBe("처음 본문");
    expect(screen.getByText("리뷰 수정")).toBeTruthy();
    expect(screen.getByText("0/5")).toBeTruthy();
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    expect(api.fetchReview).toHaveBeenCalledWith(
      12,
      "token",
      expect.anything(),
    );
  });

  it("본문을 고쳐 수정하면 PATCH를 보내고 토스트와 함께 장소 상세로 나간다", async () => {
    api.updateReview.mockResolvedValue(undefined);
    const { onSuccess } = mount();

    await type("고친 본문");
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.updateReview).toHaveBeenCalledWith(
      12,
      { description: "고친 본문" },
      "token",
    );
    expect(await screen.findByText("리뷰를 수정했어요")).toBeTruthy();
  });

  it("수정에 성공하면 이 리뷰는 다시 받지 않고 고친 본문으로 바꿔 두며, 목록은 낡은 것으로 표시한다", async () => {
    api.updateReview.mockResolvedValue(undefined);
    const { client, onSuccess } = mount();
    client.setQueryData<ReviewListResponse>(reviewKeys.list(3), {
      items: [],
    });

    await type("고친 본문");
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(
      client.getQueryData<ReviewDetailResponse>(reviewKeys.detail(12))
        ?.description,
    ).toBe("고친 본문");
    expect(api.fetchReview).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(reviewKeys.list(3))?.isInvalidated).toBe(true);
  });

  it("본문을 모두 지우면 빈 본문으로 보낸다", async () => {
    api.updateReview.mockResolvedValue(undefined);
    const { onSuccess } = mount();

    await type("");
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.updateReview).toHaveBeenCalledWith(
      12,
      { description: "" },
      "token",
    );
  });

  it("고친 것이 없으면 뒤로 바로 나간다", async () => {
    const { onClose } = mount();

    await textarea();
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("고쳤으면 뒤로를 누를 때 확인을 받는다", async () => {
    const { onClose } = mount();

    await type("고친 본문");
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(await screen.findByText("수정한 내용이 사라져요")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("보내는 동안에는 뒤로를 막고 수정 중이라고 알린다", async () => {
    api.updateReview.mockReturnValue(new Promise(() => {}));
    const { onClose } = mount();

    await type("고친 본문");
    fireEvent.click(submitButton());

    const back = screen.getByRole("button", { name: "뒤로" });
    await waitFor(() =>
      expect(back.getAttribute("aria-disabled")).toBe("true"),
    );
    fireEvent.click(back);
    expect(screen.queryByText("수정한 내용이 사라져요")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: "수정하는 중" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.getByText("리뷰를 수정하고 있어요")).toBeTruthy();
  });

  it("서버 오류면 6-E07을 띄우고 다시 수정할 수 있으며 입력은 남는다", async () => {
    api.updateReview
      .mockRejectedValueOnce(http(500))
      .mockResolvedValue(undefined);
    const { onSuccess } = mount();

    await type("고친 본문");
    fireEvent.click(submitButton());

    expect(await screen.findByText("리뷰를 수정하지 못했어요")).toBeTruthy();
    // 창이 열린 동안 뒤 화면은 접근성 트리에서 숨는다
    expect(
      (
        screen.getByRole("textbox", {
          name: "리뷰",
          hidden: true,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("고친 본문");
    fireEvent.click(screen.getByRole("button", { name: "다시 수정" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.updateReview).toHaveBeenCalledTimes(2);
  });

  it.each([404, 403])(
    "그사이 고칠 수 없게 된 리뷰(%s)면 알리고 나가기로 나간다",
    async (status) => {
      api.updateReview.mockRejectedValue(http(status));
      const { onClose } = mount();

      await type("고친 본문");
      fireEvent.click(submitButton());

      expect(
        await screen.findByText("삭제됐거나 고칠 수 없는 리뷰예요."),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "나가기" }));
      expect(onClose).toHaveBeenCalled();
    },
  );

  it("로그인이 끝났으면(401) 다시 로그인하라고 알리고 입력은 남는다", async () => {
    api.updateReview.mockRejectedValue(http(401));
    mount();

    await type("고친 본문");
    fireEvent.click(submitButton());

    expect(await screen.findByText("로그인이 끝났어요")).toBeTruthy();
    expect(
      (
        screen.getByRole("textbox", {
          name: "리뷰",
          hidden: true,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("고친 본문");
  });

  it("오프라인이면 기다리지 않고 바로 연결이 끊겼다고 알린다", async () => {
    api.updateReview.mockRejectedValue(new ApiError("network", ""));
    mount();

    await type("고친 본문");
    onlineManager.setOnline(false);
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("인터넷에 연결되어 있지 않아요"),
    ).toBeTruthy();
    expect(api.updateReview).toHaveBeenCalledTimes(1);
  });

  it("오프라인에서 열면 빈 틀이 아니라 다시 시도를 보인다", async () => {
    api.fetchReview.mockRejectedValue(new ApiError("network", ""));
    onlineManager.setOnline(false);
    mount();

    expect(await screen.findByText("리뷰를 불러오지 못했어요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it.each([404, 403])(
    "불러올 때 %s면 고칠 수 없는 리뷰라고 안내한다",
    async (status) => {
      api.fetchReview.mockRejectedValue(http(status));
      mount();

      expect(await screen.findByText("리뷰를 찾을 수 없어요")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
    },
  );

  it("불러올 때 401이면 로그인 화면으로 보낸다", async () => {
    api.fetchReview.mockRejectedValue(http(401));
    const { onSignedOut } = mount();

    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });

  it("다시 열면 저장된 지금 본문으로 시작한다", async () => {
    const first = mount();
    await type("나가기 전에 쓰던 본문");
    first.unmount();
    api.fetchReview.mockResolvedValue({
      ...review,
      description: "다른 창에서 고친 본문",
    });

    render(
      <QueryClientProvider client={first.client}>
        <ToastProvider>
          <ReviewEditForm
            reviewId={12}
            withAccessToken={withAccessToken}
            onSuccess={() => {}}
            onClose={() => {}}
            onSignedOut={() => {}}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await waitFor(async () =>
      expect((await textarea()).value).toBe("다른 창에서 고친 본문"),
    );
  });
});
