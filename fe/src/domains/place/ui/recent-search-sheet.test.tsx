// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { RecentSearchSheet } from "./recent-search-sheet";
import type { ThreadAuth } from "./thread-storage";

// 실제 시트(Base UI Drawer)는 닫히는 애니메이션 동안 내용을 남겨 둔다. 그 틈을 그대로 재현하려고 닫혀도 내용을 둔다
vi.mock("@/shared/ui/overlay/bottom-sheet", () => ({
  BottomSheet: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const member: ThreadAuth = {
  current: () => ({ kind: "member", userId: "u1", sessionId: "s1" }),
  resolve: async () => ({ kind: "member", userId: "u1", sessionId: "s1" }),
  send: async (_key, request) => {
    const data = await request();
    return data as never;
  },
};

function renderSheet(threadAuth?: ThreadAuth, currentThreadId?: string) {
  const client = createQueryClient();
  const onOpenThread = vi.fn();
  const sheet = (open: boolean) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RecentSearchSheet
          open={open}
          onOpenChange={() => {}}
          threadAuth={threadAuth}
          currentThreadId={currentThreadId}
          onOpenThread={onOpenThread}
        />
      </ToastProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(sheet(true));
  return { onOpenThread, close: () => rerender(sheet(false)) };
}

// 줄마다 지우기 버튼이 따로 있어 줄을 여는 버튼만 고른다
const rows = () =>
  within(screen.getByRole("list", { name: "최근 검색 목록" }))
    .getAllByRole("button")
    .filter((button) => !button.hasAttribute("aria-label"));
const titles = () =>
  rows().map((row) => row.querySelector(".truncate")?.textContent);

type Call = { url: string; method: string };

// 회원 목록은 두 줄이다. 지우기 응답은 respond가 정한다
function stubServer(respond: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const call = { url: String(input), method: init?.method ?? "GET" };
      calls.push(call);
      if (call.method === "GET")
        return Response.json({
          items: [
            { id: "thread-a", title: "강남 술집", lastAt: 2 },
            { id: "thread-b", title: "역삼 카페", lastAt: 1 },
          ],
        });
      return respond(call);
    }),
  );
  return calls;
}

it("받는 동안 시트가 닫히면, 닫히는 중에 응답이 와도 그 thread로 바꾸지 않는다", async () => {
  let release: (value: unknown) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/v1/me/search-threads") {
        return Response.json({
          items: [{ id: "thread-a", title: "강남 술집", lastAt: 1 }],
        });
      }
      await new Promise((resolve) => (release = resolve));
      return Response.json({
        id: "thread-a",
        turns: [
          {
            id: "entry-a",
            kind: "new",
            at: 1,
            request: { query: "강남 술집" },
            response: { items: [], totalCount: 0, conditions: {} },
          },
        ],
      });
    }),
  );
  const { onOpenThread, close } = renderSheet(member);

  await screen.findByRole("list", { name: "최근 검색 목록" });
  fireEvent.click(rows()[0]);
  await screen.findByText("불러오는 중");
  close();
  await act(async () => release(undefined));

  expect(onOpenThread).not.toHaveBeenCalled();
});

describe("최근 검색 지우기(D-18)", () => {
  it("회원이 X를 누르면 그 thread를 서버에서 지우고, 응답이 온 뒤에 그 줄만 뺀다", async () => {
    let release: () => void = () => {};
    const calls = stubServer(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return new Response(null, { status: 204 });
    });
    renderSheet(member, "thread-a");

    fireEvent.click(
      await screen.findByRole("button", { name: "강남 술집 검색 기록 지우기" }),
    );

    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        url: "/api/v1/me/search-threads/thread-a",
        method: "DELETE",
      }),
    );
    expect(titles()).toEqual(["강남 술집", "역삼 카페"]);
    await act(async () => release());
    await waitFor(() => expect(titles()).toEqual(["역삼 카페"]));
  });

  it("지우지 못하면 줄을 남기고 알린다", async () => {
    stubServer(() => Response.json({ status: 500 }, { status: 500 }));
    renderSheet(member);

    fireEvent.click(
      await screen.findByRole("button", { name: "역삼 카페 검색 기록 지우기" }),
    );

    expect(
      await screen.findByText("지우지 못했어요. 다시 시도해 주세요."),
    ).toBeTruthy();
    expect(titles()).toEqual(["강남 술집", "역삼 카페"]);
  });

  it("비회원이 X를 누르면 기기 기록에서 바로 뺀다", async () => {
    const thread = (id: string, query: string, at: number) => ({
      id,
      turns: [
        {
          id: `entry-${id}`,
          kind: "new",
          at,
          request: { query },
          response: { items: [], totalCount: 0, conditions: {} },
        },
      ],
    });
    localStorage.setItem(
      "fit-dining:guest-search-threads",
      JSON.stringify([
        thread("thread-a", "강남 술집", 2),
        thread("thread-b", "역삼 카페", 1),
      ]),
    );
    renderSheet();

    fireEvent.click(
      screen.getByRole("button", { name: "강남 술집 검색 기록 지우기" }),
    );

    await waitFor(() => expect(titles()).toEqual(["역삼 카페"]));
    const stored = JSON.parse(
      localStorage.getItem("fit-dining:guest-search-threads") ?? "[]",
    );
    expect(stored.map(({ id }: { id: string }) => id)).toEqual(["thread-b"]);
  });

  it("전체 삭제는 확인 창에서 [삭제]를 골라야 지우고, 지우면 빈 안내를 보인다", async () => {
    const calls = stubServer(() => new Response(null, { status: 204 }));
    renderSheet(member);

    fireEvent.click(await screen.findByRole("button", { name: "전체 삭제" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "최근 검색을 모두 지울까요?",
    });
    expect(
      within(dialog).getByText("검색 기록은 복구할 수 없어요."),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(calls.filter(({ method }) => method === "DELETE")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "전체 삭제" }));
    fireEvent.click(
      within(
        await screen.findByRole("alertdialog", {
          name: "최근 검색을 모두 지울까요?",
        }),
      ).getByRole("button", { name: "삭제" }),
    );

    expect(
      await screen.findByText(
        "아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.",
      ),
    ).toBeTruthy();
    expect(calls.at(-1)).toEqual({
      url: "/api/v1/me/search-threads",
      method: "DELETE",
    });
  });
});
