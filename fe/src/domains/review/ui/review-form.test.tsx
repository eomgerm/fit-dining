// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { reviewKeys, type WithAccessToken } from "../api/queries";
import type { ReviewFormResponse } from "../model/review";
import { ReviewForm, ReviewWriteFlow } from "./review-form";
import {
  clearVisitEntry,
  saveVisitEntry,
  useVisitEntry,
} from "./visit-entry-store";

const api = vi.hoisted(() => ({
  fetchReviews: vi.fn(),
  fetchReviewForm: vi.fn(),
  createReview: vi.fn(),
  fetchPhotoUploads: vi.fn(),
  putPhoto: vi.fn(),
}));
vi.mock("../api/review-api", () => api);

const compress = vi.hoisted(() => ({ compressPhoto: vi.fn() }));
vi.mock("../model/photo-compress", async (original) => ({
  ...(await original<typeof import("../model/photo-compress")>()),
  compressPhoto: compress.compressPhoto,
}));

function form(reviewedDates: string[] = []): ReviewFormResponse {
  return {
    place: { name: "카페 온담", categoryGroup: "CAFE", station: "YEOKSAM" },
    visitDate: { min: "2026-09-21", max: "2026-10-21", default: "2026-10-21" },
    reviewedDates,
    tags: {
      good: [
        {
          code: "QUIET_GOOD",
          label: "조용해서 좋았어요",
          group: "NOISE",
          displayGroup: "분위기",
        },
      ],
      bad: [
        {
          code: "LIVELY_BAD",
          label: "너무 시끄러웠어요",
          group: "NOISE",
          displayGroup: "분위기",
        },
      ],
    },
    limits: { descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1_000_000 },
    writable: true,
  };
}

const withAccessToken: WithAccessToken = (send) => send("token");
const unauthorized = () =>
  new ApiError("http", "로그인이 필요합니다", { status: 401 });

function flow(
  data: ReviewFormResponse,
  props: { onClose?: () => void; onReload?: () => void } = {},
) {
  return (
    <ReviewWriteFlow
      placeId={3}
      form={data}
      withAccessToken={withAccessToken}
      onSuccess={() => {}}
      onClose={props.onClose ?? (() => {})}
      onReload={props.onReload ?? (() => {})}
    />
  );
}

function markup(data = form()) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>{flow(data)}</ToastProvider>
    </QueryClientProvider>,
  );
}

function mount(ui: ReactNode) {
  const client = new QueryClient();
  const view = render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    ),
  });
  return { client, ...view };
}

function mountForm(
  props: { onClose?: () => void; onSignedOut?: () => void } = {},
) {
  return mount(
    <ReviewForm
      placeId={3}
      withAccessToken={withAccessToken}
      onSuccess={() => {}}
      onClose={props.onClose ?? (() => {})}
      onSignedOut={props.onSignedOut ?? (() => {})}
    />,
  );
}

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  api.fetchReviewForm.mockReset().mockResolvedValue(form());
  api.createReview.mockReset();
});

afterEach(() => {
  cleanup();
  clearVisitEntry(3);
  vi.restoreAllMocks();
});

describe("ReviewWriteFlow", () => {
  it("1/2단계 좋았던 점부터 시작하고 닫기 버튼이 있다", () => {
    const html = markup();

    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-label="닫기"');
    expect(html).toContain("카페 온담");
    expect(html).toContain("오늘 · 10월 21일 (수)");
    expect(html).toContain("어떤 점이 좋았나요?");
    expect(html).toContain("조용해서 좋았어요");
    expect(html).not.toContain("너무 시끄러웠어요");
  });

  it("좋았던 점을 고르기 전에는 다음이 비활성이다", () => {
    expect(markup()).toMatch(/<button[^>]*disabled=""[^>]*>다음<\/button>/);
  });

  it("오늘 이미 쓴 장소면 방문일을 고르라고 한다", () => {
    expect(markup(form(["2026-10-21"]))).toContain("방문일을 골라 주세요");
  });

  it("장소 상세에서 방문을 확인하고 들어오면 장소 이름 아래에 방문 확인 완료를 보인다", () => {
    expect(markup()).not.toContain("방문 확인 완료");

    saveVisitEntry(3, { verified: true, pickDate: false });
    mount(flow(form()));

    expect(screen.getByText("방문 확인 완료")).toBeTruthy();
  });

  it("방문 확인 결과는 흐름으로 옮긴 뒤 저장소에서 지워, 새로 열면 남지 않는다", () => {
    saveVisitEntry(3, { verified: true, pickDate: false });
    const view = mount(flow(form()));
    expect(screen.getByText("방문 확인 완료")).toBeTruthy();
    expect(renderHook(() => useVisitEntry(3)).result.current).toBeUndefined();

    view.unmount();
    mount(flow(form()));

    expect(screen.queryByText("방문 확인 완료")).toBeNull();
  });

  it("방문일을 오늘이 아닌 날로 바꾸면 방문 확인 완료를 숨긴다", async () => {
    saveVisitEntry(3, { verified: true, pickDate: false });
    mount(flow(form()));

    fireEvent.click(screen.getByRole("button", { name: /방문일/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "10월 20일 (화)" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "10월 20일 (화) 선택" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("방문 확인 완료")).toBeNull(),
    );
  });

  it("7-E01의 다른 날 고르기로 들어오면 방문일 시트를 연다", async () => {
    saveVisitEntry(3, { verified: false, pickDate: true });
    mount(flow(form(["2026-10-21"])));

    expect(
      await screen.findByText("같은 날에 또 리뷰를 작성할 수 없어요."),
    ).toBeTruthy();
    expect(screen.queryByText("방문 확인 완료")).toBeNull();
  });

  it("1/2단계는 장소·방문일 줄과 질문까지 고정하고 태그 목록만 스크롤한다", () => {
    mount(flow(form()));
    const head = screen.getByRole("banner").parentElement!;
    const chip = screen.getByRole("button", { name: "조용해서 좋았어요" });
    const scroller = chip.closest(".overflow-y-auto")!;

    expect(head.contains(screen.getByText("카페 온담"))).toBe(true);
    expect(head.contains(screen.getByRole("button", { name: /방문일/ }))).toBe(
      true,
    );
    expect(head.contains(screen.getByText("어떤 점이 좋았나요?"))).toBe(true);
    expect(head.contains(scroller)).toBe(false);
    expect(
      scroller.contains(screen.getByRole("button", { name: "다음" })),
    ).toBe(false);

    fireEvent.click(chip);
    scroller.scrollTop = 120;
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(head.contains(screen.getByText("아쉬운 점도 있었나요?"))).toBe(true);
    expect(scroller.scrollTop).toBe(0);
  });

  it("2/2단계에서 1단계로 돌아갔다 와도 2/2단계 입력이 남는다", () => {
    mount(flow(form()));
    fireEvent.click(screen.getByRole("button", { name: "조용해서 좋았어요" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "재방문 의사 있어요" }));
    fireEvent.change(screen.getByLabelText("리뷰"), {
      target: { value: "조용했어요" },
    });
    fireEvent.change(screen.getByLabelText("1인당 쓴 금액"), {
      target: { value: "12000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "아쉬웠던 점으로" }));
    fireEvent.click(screen.getByRole("button", { name: "좋았던 점으로" }));
    expect(pressed("조용해서 좋았어요")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(pressed("재방문 의사 있어요")).toBe("true");
    expect((screen.getByLabelText("리뷰") as HTMLTextAreaElement).value).toBe(
      "조용했어요",
    );
    expect(
      (screen.getByLabelText("1인당 쓴 금액") as HTMLInputElement).value,
    ).toBe("12,000");
  });

  it("다시 받은 데이터에서 이미 쓴 날이 된 방문일을 비운다", () => {
    const view = mount(flow(form()));

    view.rerender(flow(form(["2026-10-21"])));

    expect(screen.getByText("방문일을 골라 주세요")).toBeTruthy();
  });

  it("다시 받은 데이터에 없는 태그는 입력에서 뺀다", () => {
    const view = mount(flow(form()));
    fireEvent.click(screen.getByRole("button", { name: "조용해서 좋았어요" }));

    view.rerender(flow({ ...form(), tags: { ...form().tags, good: [] } }));
    view.rerender(flow(form()));

    expect(pressed("조용해서 좋았어요")).toBe("false");
  });

  it("방문일이 빠진 채 등록하면 보내지 않고 7-01로 돌아가 방문일 시트를 연다", async () => {
    const view = mount(flow(form()));
    fireEvent.click(screen.getByRole("button", { name: "조용해서 좋았어요" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    view.rerender(flow(form(["2026-10-21"])));
    fireEvent.click(screen.getByRole("button", { name: "건너뛰고 등록하기" }));

    expect(screen.getByText("어떤 점이 좋았나요?")).toBeTruthy();
    expect(
      await screen.findByText("같은 날에 또 리뷰를 작성할 수 없어요."),
    ).toBeTruthy();
    expect(api.createReview).not.toHaveBeenCalled();
  });

  it("다시 받은 데이터 때문에 방문일만 비었으면 X에 7-E03 없이 나간다", () => {
    const onClose = vi.fn();
    const view = mount(flow(form(), { onClose }));

    view.rerender(flow(form(["2026-10-21"]), { onClose }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText("작성한 내용이 사라져요")).toBeNull();
  });

  it("등록이 404면 장소를 찾을 수 없다고 하고 다시 받지 않은 채 나가게 한다", async () => {
    api.createReview.mockRejectedValue(
      new ApiError("http", "장소 없음", { status: 404 }),
    );
    const onClose = vi.fn();
    const onReload = vi.fn();
    mount(flow(form(), { onClose, onReload }));
    fireEvent.click(screen.getByRole("button", { name: "조용해서 좋았어요" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "건너뛰고 등록하기" }));

    expect(await screen.findByText("장소를 찾을 수 없어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onReload).not.toHaveBeenCalled();
  });
});

describe("ReviewWriteFlow 사진", () => {
  beforeEach(() => {
    compress.compressPhoto.mockResolvedValue({
      photo: new Blob(["photo"]),
      thumb: new Blob(["thumb"]),
    });
    api.fetchPhotoUploads.mockResolvedValue({
      uploads: [
        {
          photoId: "photo-1",
          uploadUrl: "/fit-dev-photos/pending/photo-1.jpg?sig",
          thumbUploadUrl: "/fit-dev-photos/pending/photo-1.thumb.jpg?sig",
          expiresAt: "2026-10-21T12:10:00+09:00",
        },
      ],
    });
    api.putPhoto.mockResolvedValue(undefined);
  });

  function toDetailWithPhoto() {
    const view = mount(flow(form()));
    fireEvent.click(screen.getByRole("button", { name: "조용해서 좋았어요" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    const input = view.container.ownerDocument.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
    return view;
  }

  it("사진을 올리는 동안 등록을 막고, 다 올리면 사진 id를 함께 보낸다", async () => {
    api.createReview.mockResolvedValue({ reviewId: 9 });
    toDetailWithPhoto();

    const submit = await screen.findByRole("button", { name: "등록하기" });
    fireEvent.click(submit);

    await waitFor(() => expect(api.createReview).toHaveBeenCalled());
    expect(api.createReview.mock.calls[0][1]).toEqual({
      visitedAt: "2026-10-21",
      tagCodes: ["QUIET_GOOD"],
      revisitIntent: false,
      photos: ["photo-1"],
    });
  });

  it("쓸 수 없는 사진(400)이면 사진 안내를 띄우고 작성 화면 데이터를 다시 받지 않는다", async () => {
    api.createReview.mockRejectedValue(
      new ApiError("http", "", {
        status: 400,
        problem: { status: 400, type: "urn:fitdining:review:invalid-photo" },
      }),
    );
    const onReload = vi.fn();
    const view = mount(flow(form(), { onReload }));
    fireEvent.click(screen.getByRole("button", { name: "조용해서 좋았어요" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.change(
      view.container.ownerDocument.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement,
      { target: { files: [new File(["x"], "a.jpg")] } },
    );
    fireEvent.click(await screen.findByRole("button", { name: "등록하기" }));

    expect(await screen.findByText("올릴 수 없는 사진이 있어요")).toBeTruthy();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("사진을 골랐으면 닫을 때 확인을 받는다", async () => {
    toDetailWithPhoto();
    await screen.findByRole("button", { name: "등록하기" });

    fireEvent.click(screen.getByRole("button", { name: "아쉬웠던 점으로" }));
    fireEvent.click(screen.getByRole("button", { name: "좋았던 점으로" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(await screen.findByText("작성한 내용이 사라져요")).toBeTruthy();
  });
});

describe("ReviewForm", () => {
  it("나가기 뒤 숨겨 둔 화면이 다시 보이면 빈 입력으로 시작한다", async () => {
    const onClose = vi.fn();
    mountForm({ onClose });
    fireEvent.click(
      await screen.findByRole("button", { name: "조용해서 좋았어요" }),
    );
    expect(pressed("조용해서 좋았어요")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(await screen.findByRole("button", { name: "나가기" }));

    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(pressed("조용해서 좋았어요")).toBe("false"));
    expect(screen.queryByText("작성한 내용이 사라져요")).toBeNull();
  });

  it("X로 나가면 장소 상세에서 넘긴 방문 확인을 지운다", async () => {
    saveVisitEntry(3, { verified: true, pickDate: false });
    mountForm();
    expect(await screen.findByText("방문 확인 완료")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() =>
      expect(screen.queryByText("방문 확인 완료")).toBeNull(),
    );
  });

  it("처음 불러올 때 401이면 로그인 화면으로 보낸다", async () => {
    api.fetchReviewForm.mockRejectedValue(unauthorized());
    const onSignedOut = vi.fn();
    mountForm({ onSignedOut });

    await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
  });

  it("쓰는 중에 다시 받다가 401이 나면 입력을 두고 로그인 화면으로 보내지 않는다", async () => {
    const onSignedOut = vi.fn();
    const { client } = mountForm({ onSignedOut });
    fireEvent.click(
      await screen.findByRole("button", { name: "조용해서 좋았어요" }),
    );

    api.fetchReviewForm.mockRejectedValue(unauthorized());
    await act(async () => {
      await client.refetchQueries({ queryKey: reviewKeys.form(3) });
      // TanStack Query는 결과를 다음 틱에 화면으로 알린다
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(client.getQueryState(reviewKeys.form(3))?.status).toBe("error");
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(pressed("조용해서 좋았어요")).toBe("true");
  });
});
