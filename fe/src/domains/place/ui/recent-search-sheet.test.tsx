// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";

import { RecentSearchSheet } from "./recent-search-sheet";
import type { ThreadAuth } from "./thread-storage";

// 실제 시트(Base UI Drawer)는 닫히는 애니메이션 동안 내용을 남겨 둔다. 그 틈을 그대로 재현하려고 닫혀도 내용을 둔다
vi.mock("@/shared/ui/overlay/bottom-sheet", () => ({
  BottomSheet: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

afterEach(cleanup);

it("받는 동안 시트가 닫히면, 닫히는 중에 응답이 와도 그 thread로 바꾸지 않는다", async () => {
  let release: (value: unknown) => void = () => {};
  const auth: ThreadAuth = {
    current: () => ({ kind: "member", userId: "u1", sessionId: "s1" }),
    resolve: async () => ({ kind: "member", userId: "u1", sessionId: "s1" }),
    send: async (_key, request) => {
      const data = await request("at");
      return data as never;
    },
  };
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
  const onOpenThread = vi.fn();
  const sheet = (open: boolean) => (
    <QueryClientProvider client={client}>
      <RecentSearchSheet
        open={open}
        onOpenChange={() => {}}
        threadAuth={auth}
        onOpenThread={onOpenThread}
      />
    </QueryClientProvider>
  );
  const client = createQueryClient();
  const { rerender } = render(sheet(true));

  fireEvent.click(await screen.findByRole("button", { name: /강남 술집/ }));
  await screen.findByText("불러오는 중");
  rerender(sheet(false));
  await act(async () => release(undefined));

  expect(onOpenThread).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
