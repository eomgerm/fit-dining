// @vitest-environment jsdom
import {
  onlineManager,
  QueryClientProvider,
  type QueryClient,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { bookmarkKeys } from "../api/bookmark-queries";
import {
  BookmarkAccountChanged,
  type BookmarkAccess,
  type BookmarkSession,
} from "../model/bookmark";
import type { PlaceCard, PlaceDetail } from "../model/place-types";
import { createSearchStore, type SearchStore } from "../model/search-store";
import { PlaceDetailScreen } from "./place-detail-screen";

// 저장한 장소 화면에서 열었는지(주소의 from=saved). 페이지가 읽어 넘긴다
let fromSaved = false;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/shared/lib/runtime-config", () => ({
  loadRuntimeConfig: async () => undefined,
}));

const stores = vi.hoisted(() => ({
  current: undefined as unknown as SearchStore,
}));
vi.mock("../model/search-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model/search-store")>();
  return {
    ...actual,
    searchStore: new Proxy({} as SearchStore, {
      get: (_, key: keyof SearchStore) => stores.current[key],
    }),
  };
});

const place = {
  id: 1,
  name: "카페 온담",
  categoryGroup: "CAFE" as const,
  station: "YEOKSAM" as const,
  lat: 37.5,
  lng: 127.03,
};

const detail: PlaceDetail = {
  place,
  address: "서울 강남구 테헤란로 1",
  tags: [],
  photos: [],
  openStatus: "OPEN",
  hours: [],
  menus: [],
  facilities: [],
  subways: [],
  noKidsZone: false,
  seats: [],
  paymentMethods: [],
  broadcasts: [],
  extraLinks: [],
};

const card: PlaceCard = {
  place,
  score: 84,
  labels: ["대화하기 좋은 곳"],
  openStatus: "OPEN",
  reasons: [
    {
      source: "REQUEST",
      code: "QUIET",
      label: "조용해요",
      value: 0.95,
      fromReviews: true,
      fallbackTitle: "카페 중 손꼽히게 조용해요",
    },
  ],
  scoreItems: [],
};

// 북마크 API 응답. 함수면 요청마다 부르고, Promise를 돌려주면 그때까지 기다린다
type Reply = () => Response | Promise<Response>;
let replies: Record<string, Reply[]>;
let calls: { method: string; url: string; auth: string | null }[];

function reply(method: string, ...queue: Reply[]) {
  replies[method] = queue;
}
const ok = (body: unknown) => () => Response.json(body);
const status = (code: number) => () =>
  Response.json({ status: code }, { status: code });
const noContent = () => new Response(null, { status: 204 });
const offline = () => Promise.reject(new TypeError("Failed to fetch"));
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { reply: () => promise, resolve };
}

beforeEach(() => {
  fromSaved = false;
  stores.current = createSearchStore();
  replies = {};
  calls = [];
  onlineManager.setOnline(true);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/v1/places/1") return Response.json(detail);
      // 추천 이유는 이 파일에서 보지 않는다. 실패하면 카드의 대체 제목이 보인다
      if (url === "/api/v1/places/1/reasons")
        return Response.json({ status: 404 }, { status: 404 });
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        auth: new Headers(init?.headers).get("Authorization"),
      });
      const next = replies[method]?.shift();
      if (!next) throw new Error(`예상하지 못한 요청 ${method} ${url}`);
      return next();
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

const bookmarkCalls = (method?: string) =>
  calls.filter((call) => !method || call.method === method);

// app의 useBookmarkAccess 대역. 세션을 바꾸면 다시 그린다
const harness = {
  setSession: (() => {}) as (session: BookmarkSession) => void,
  current: undefined as string | undefined,
  endSession: vi.fn(),
  login: vi.fn(),
};

function Harness({ initial }: { initial: BookmarkSession }) {
  const [session, setSession] = useState(initial);
  useEffect(() => {
    harness.setSession = (next) => {
      harness.current = next.status === "user" ? next.userId : undefined;
      setSession(next);
    };
  }, []);
  const access: BookmarkAccess = {
    session,
    currentUserId: () => harness.current,
    async send(userId, request) {
      if (harness.current !== userId) throw new BookmarkAccountChanged();
      return request();
    },
    endSession: () => {
      harness.endSession();
      harness.setSession({ status: "guest" });
    },
    login: harness.login,
  };
  return (
    <PlaceDetailScreen placeId={1} fromSaved={fromSaved} bookmarks={access} />
  );
}

let queryClient: QueryClient;

async function renderDetail(initial: BookmarkSession = user("a")) {
  harness.current = initial.status === "user" ? initial.userId : undefined;
  harness.endSession.mockReset();
  harness.login.mockReset();
  queryClient = createQueryClient();
  // 오프라인 시험에서도 상세가 그려지도록 장소 상세는 미리 받아 둔다(북마크 요청만 본다)
  queryClient.setQueryData(["places", "detail", 1], detail);
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Harness initial={initial} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "카페 온담" });
}

function user(userId: string): BookmarkSession {
  return { status: "user", userId };
}

const button = (name: string) => screen.findByRole("button", { name });

describe("상세 저장 버튼의 모양", () => {
  it("저장 여부를 확인하는 동안은 눌리지 않는 확인 중 표시이고 aria-pressed가 없다", async () => {
    const pending = deferred();
    reply("GET", pending.reply);
    await renderDetail();

    const checking = await button("저장 상태 확인 중");
    expect((checking as HTMLButtonElement).disabled).toBe(true);
    expect(checking.hasAttribute("aria-pressed")).toBe(false);

    await act(async () => pending.resolve(Response.json({ bookmarked: true })));
    const saved = await button("저장 해제");
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    expect(bookmarkCalls()[0]).toEqual({
      method: "GET",
      url: "/api/v1/me/bookmarks/1",
      auth: null,
    });
  });

  it("저장하지 않았으면 빈 북마크 '저장'이고 aria-pressed가 false다", async () => {
    reply("GET", ok({ bookmarked: false }));
    await renderDetail();

    expect((await button("저장")).getAttribute("aria-pressed")).toBe("false");
  });

  it("로그인 복원 중이면 확인 중 표시이고 요청하지 않는다", async () => {
    await renderDetail({ status: "checking" });

    expect(
      ((await button("저장 상태 확인 중")) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(bookmarkCalls()).toHaveLength(0);
  });

  it("확인에 실패하면 다시 시도 표시이고, 누르면 쓰기 없이 다시 확인한다", async () => {
    reply("GET", status(500), ok({ bookmarked: true }));
    await renderDetail();

    const retry = await button("저장 상태 다시 확인");
    expect(retry.hasAttribute("aria-pressed")).toBe(false);
    // 자동 재시도는 없다
    expect(bookmarkCalls("GET")).toHaveLength(1);

    fireEvent.click(retry);

    expect(await button("저장 해제")).toBeTruthy();
    expect(bookmarkCalls("GET")).toHaveLength(2);
    expect(bookmarkCalls("PUT")).toHaveLength(0);
  });
});

describe("저장과 해제", () => {
  it("요청 중에는 버튼이 그대로이고 눌리지 않으며, 204면 바뀌고 토스트가 뜬다", async () => {
    reply("GET", ok({ bookmarked: false }));
    const put = deferred();
    reply("PUT", put.reply);
    reply("DELETE", noContent);
    await renderDetail();

    fireEvent.click(await button("저장"));
    const pending = await button("저장");
    await waitFor(() =>
      expect((pending as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.click(pending);
    expect(bookmarkCalls("PUT")).toHaveLength(1);

    await act(async () => put.resolve(noContent()));
    expect(await screen.findByText("저장했어요")).toBeTruthy();
    const saved = await button("저장 해제");
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    expect(bookmarkCalls("PUT")[0].auth).toBe(null);

    fireEvent.click(saved);
    expect(await screen.findByText("저장을 해제했어요")).toBeTruthy();
    expect(await button("저장")).toBeTruthy();
    expect(bookmarkCalls("DELETE")[0].url).toBe("/api/v1/me/bookmarks/1");
  });

  it("저장에 성공했을 때만 아이콘이 커졌다 돌아오고, 열 때 이미 저장돼 있으면 그대로다", async () => {
    reply("GET", ok({ bookmarked: true }));
    reply("PUT", noContent);
    reply("DELETE", noContent);
    await renderDetail();
    const popping = async (name: string) =>
      (await button(name)).innerHTML.includes("animate-bookmark-pop");

    expect(await popping("저장 해제")).toBe(false);

    fireEvent.click(await button("저장 해제"));
    await screen.findByText("저장을 해제했어요");
    fireEvent.click(await button("저장"));
    await screen.findByText("저장했어요");

    expect(await popping("저장 해제")).toBe(true);
  });

  it("성공하면 같은 사용자의 저장 여부와 내 목록 캐시가 함께 맞춰진다", async () => {
    reply("GET", ok({ bookmarked: false }));
    reply("PUT", noContent);
    await renderDetail();
    queryClient.setQueryData([...bookmarkKeys.lists("a"), 1], []);

    fireEvent.click(await button("저장"));
    await screen.findByText("저장했어요");

    expect(queryClient.getQueryData(bookmarkKeys.status("a", 1))).toEqual({
      bookmarked: true,
    });
    expect(
      queryClient.getQueryState([...bookmarkKeys.lists("a"), 1])?.isInvalidated,
    ).toBe(true);
    // 장소 상세 데이터는 다시 받지 않는다
    expect(queryClient.getQueryData(["places", "detail", 1])).toEqual(detail);
  });

  it.each([
    ["PUT", false, "저장하지 못했어요. 다시 시도해 주세요.", "저장"],
    [
      "DELETE",
      true,
      "저장을 해제하지 못했어요. 다시 시도해 주세요.",
      "저장 해제",
    ],
  ])(
    "%s가 4xx면 실패 토스트가 뜨고 누르기 전 상태로 남으며 다시 조회하지 않는다",
    async (method, bookmarked, message, label) => {
      reply("GET", ok({ bookmarked }));
      reply(method, status(404));
      await renderDetail();

      fireEvent.click(await button(label));

      expect(await screen.findByText(message)).toBeTruthy();
      expect(await button(label)).toBeTruthy();
      expect(bookmarkCalls("GET")).toHaveLength(1);
    },
  );

  it("5xx면 실패 토스트가 뜨고 다시 조회한 결과로 보인다", async () => {
    reply("GET", ok({ bookmarked: false }), ok({ bookmarked: true }));
    reply("PUT", status(503));
    await renderDetail();

    fireEvent.click(await button("저장"));

    expect(
      await screen.findByText("저장하지 못했어요. 다시 시도해 주세요."),
    ).toBeTruthy();
    expect(await button("저장 해제")).toBeTruthy();
    expect(bookmarkCalls("GET")).toHaveLength(2);
  });

  it("5xx 뒤 다시 조회도 실패하면 확인 실패 표시다", async () => {
    reply("GET", ok({ bookmarked: false }), status(500));
    reply("PUT", status(500));
    await renderDetail();

    fireEvent.click(await button("저장"));

    expect(await button("저장 상태 다시 확인")).toBeTruthy();
  });

  it("연결이 끊기면 토스트 없이 다시 조회해 그 결과로 보인다", async () => {
    reply("GET", ok({ bookmarked: false }), ok({ bookmarked: true }));
    reply("PUT", offline);
    await renderDetail();

    fireEvent.click(await button("저장"));

    expect(await button("저장 해제")).toBeTruthy();
    expect(screen.queryByText(/못했어요|인터넷/)).toBeNull();
  });

  it("연결이 끊기고 다시 조회도 실패하면 확인 실패 표시와 연결 확인 토스트다", async () => {
    reply("GET", ok({ bookmarked: false }), offline);
    reply("PUT", offline);
    await renderDetail();

    fireEvent.click(await button("저장"));

    expect(await button("저장 상태 다시 확인")).toBeTruthy();
    expect(
      await screen.findByText("인터넷 연결을 확인하고 다시 시도해 주세요."),
    ).toBeTruthy();
  });
});

describe("오프라인", () => {
  it("조회는 연결을 기다리지 않고 바로 실패하며, 연결이 돌아와도 다시 나가지 않는다", async () => {
    onlineManager.setOnline(false);
    reply("GET", offline);
    await renderDetail();

    expect(await button("저장 상태 다시 확인")).toBeTruthy();
    expect(bookmarkCalls("GET")).toHaveLength(1);

    act(() => onlineManager.setOnline(true));
    await new Promise((done) => setTimeout(done, 50));
    expect(bookmarkCalls("GET")).toHaveLength(1);
  });

  it("쓰기는 연결을 기다리지 않고 바로 끝나며 연결이 돌아와도 다시 보내지 않는다", async () => {
    reply("GET", ok({ bookmarked: false }), offline);
    reply("PUT", offline);
    await renderDetail();
    const save = await button("저장");
    onlineManager.setOnline(false);

    fireEvent.click(save);

    expect(
      await screen.findByText("인터넷 연결을 확인하고 다시 시도해 주세요."),
    ).toBeTruthy();
    act(() => onlineManager.setOnline(true));
    await new Promise((done) => setTimeout(done, 50));
    expect(bookmarkCalls("PUT")).toHaveLength(1);
  });
});

describe("계정 전환", () => {
  it("요청 중에 다른 계정으로 바뀌면 늦은 응답을 버리고 새 계정의 저장 여부를 받는다", async () => {
    reply("GET", ok({ bookmarked: false }), ok({ bookmarked: false }));
    const put = deferred();
    reply("PUT", put.reply);
    await renderDetail();

    fireEvent.click(await button("저장"));
    await waitFor(() => expect(bookmarkCalls("PUT")).toHaveLength(1));
    act(() => harness.setSession(user("b")));
    await act(async () => put.resolve(noContent()));

    expect(await button("저장")).toBeTruthy();
    expect(screen.queryByText("저장했어요")).toBeNull();
    expect(bookmarkCalls("GET")[1].auth).toBe(null);
    expect(queryClient.getQueryData(bookmarkKeys.status("a", 1))).toEqual({
      bookmarked: false,
    });
  });

  it("요청 중에 다른 계정으로 바뀐 뒤 그 요청이 401로 끝나면 새 계정의 세션을 지우지 않는다", async () => {
    reply("GET", ok({ bookmarked: false }), ok({ bookmarked: false }));
    const put = deferred();
    reply("PUT", put.reply);
    await renderDetail();

    fireEvent.click(await button("저장"));
    await waitFor(() => expect(bookmarkCalls("PUT")).toHaveLength(1));
    act(() => harness.setSession(user("b")));
    await act(async () => put.resolve(status(401)()));

    expect(await button("저장")).toBeTruthy();
    expect(harness.endSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(harness.current).toBe("b");
  });

  it("보내는 순간 계정이 다르면 보내지 않고 결과를 버린다", async () => {
    reply("GET", ok({ bookmarked: false }));
    await renderDetail();
    const save = await button("저장");
    // 다른 탭에서 계정이 바뀌었지만 이 화면은 아직 모른다
    harness.current = "b";

    fireEvent.click(save);
    await new Promise((done) => setTimeout(done, 20));

    expect(bookmarkCalls("PUT")).toHaveLength(0);
    expect(screen.queryByText(/저장했어요|못했어요/)).toBeNull();
  });
});

describe("비로그인과 세션 종료", () => {
  it("비로그인 사용자는 조회하지 않고 '저장'이며, 누르면 로그인 안내가 뜨고 [취소]는 요청 없이 닫는다", async () => {
    await renderDetail({ status: "guest" });

    const save = await button("저장");
    expect(save.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(save);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("로그인이 필요해요")).toBeTruthy();
    expect(
      within(dialog).getByText("장소 저장은 로그인해야 이용할 수 있어요."),
    ).toBeTruthy();
    // 북마크 기능 전에는 '준비 중이에요'를 띄웠다(AC-28)
    expect(screen.queryByText("준비 중이에요")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(bookmarkCalls()).toHaveLength(0);
    expect(harness.login).not.toHaveBeenCalled();
  });

  it.each([
    [false, "/places/1"],
    [true, "/places/1?from=saved"],
  ])(
    "fromSaved=%s에서 [로그인]을 고르면 %s로 돌아오게 남긴다",
    async (saved, path) => {
      fromSaved = saved;
      await renderDetail({ status: "guest" });

      fireEvent.click(await button("저장"));
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "로그인",
        }),
      );

      expect(harness.login).toHaveBeenCalledWith(path);
    },
  );

  it("누른 저장이 401로 끝나면 실패 토스트 없이 세션을 지우고 로그인 안내를 띄운다", async () => {
    reply("GET", ok({ bookmarked: false }));
    reply("PUT", status(401));
    await renderDetail();

    fireEvent.click(await button("저장"));

    const dialog = await screen.findByRole("alertdialog");
    expect(harness.endSession).toHaveBeenCalled();
    expect(screen.queryByText(/못했어요/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect((await button("저장")).getAttribute("aria-pressed")).toBe("false");
  });

  it("5xx 뒤 다시 조회가 401이면 세션을 지우고 로그인 안내를 띄운다", async () => {
    reply("GET", ok({ bookmarked: false }), status(401));
    reply("PUT", status(500));
    await renderDetail();

    fireEvent.click(await button("저장"));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(harness.endSession).toHaveBeenCalled();
  });

  it("상세를 열 때 저절로 나간 조회가 401이면 창 없이 비로그인 모양이 된다", async () => {
    reply("GET", status(401));
    await renderDetail();

    await waitFor(() => expect(harness.endSession).toHaveBeenCalled());
    expect((await button("저장")).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("저장한 장소에서 연 상세", () => {
  it("from=saved면 같은 세션에 검색 카드가 있어도 핏 점수와 추천 이유를 보이지 않는다", async () => {
    stores.current.recordCards([card]);
    fromSaved = true;
    reply("GET", ok({ bookmarked: true }));
    await renderDetail();

    expect(await button("저장 해제")).toBeTruthy();
    expect(screen.queryByText("핏 점수")).toBeNull();
    expect(
      screen.queryByText("조용히 대화하기 좋다는 리뷰가 많아요"),
    ).toBeNull();
  });

  it("from이 없으면 검색 카드의 핏 점수를 보인다", async () => {
    stores.current.recordCards([card]);
    reply("GET", ok({ bookmarked: true }));
    await renderDetail();

    expect(await screen.findByText("핏 점수")).toBeTruthy();
  });
});
