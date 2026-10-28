// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useReviewList, type WithOptionalAccessToken } from "./queries";

const api = vi.hoisted(() => ({
  fetchReviews: vi.fn(),
  fetchReviewForm: vi.fn(),
  createReview: vi.fn(),
}));
vi.mock("./review-api", () => api);

describe("useReviewList", () => {
  it("app이 넘긴 함수가 준 AT로 목록을 받는다", async () => {
    api.fetchReviews.mockResolvedValue({ items: [] });
    const withToken: WithOptionalAccessToken = (send) => send("access");
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useReviewList(3, withToken), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchReviews).toHaveBeenCalledWith(
      3,
      undefined,
      expect.any(AbortSignal),
      "access",
    );
  });
});
