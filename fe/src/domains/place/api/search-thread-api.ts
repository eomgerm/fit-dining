import { request } from "@/shared/api/client";

import type { ThreadSummary, ThreadTurn } from "../model/search-threads";

// 회원의 검색 기록 API(search-thread D-3). 모두 로그인이 필요하고 AT는 부르는 쪽이 넘긴다

export type ThreadPage = {
  items: ThreadSummary[];
  // 다음 페이지가 실제로 있을 때만 있다
  nextCursor?: string;
};

// 같은 id를 다른 내용으로 다시 보냈을 때의 409. 이미 저장된 것으로 본다(D-5)
export const TURN_CONFLICT_TYPE = "urn:fitdining:search-thread:conflict";

const auth = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
});

// 마지막 요청 시각 최신순 20개씩. cursor는 직전 응답의 nextCursor다
export function fetchThreadPage(
  accessToken: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  return request<ThreadPage>("/v1/me/search-threads", {
    query: { cursor },
    headers: auth(accessToken),
    signal,
  });
}

// thread 하나. 모양은 받는 쪽이 parseThreads로 확인한다
export function fetchThread(
  threadId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  return request<unknown>(
    `/v1/me/search-threads/${encodeURIComponent(threadId)}`,
    { headers: auth(accessToken), signal },
  );
}

// turn 하나를 thread에 더한다. thread의 첫 turn이면 thread가 생긴다
export function putTurn(
  threadId: string,
  turn: ThreadTurn,
  accessToken: string,
) {
  return request<void>(
    `/v1/me/search-threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turn.id)}`,
    { method: "PUT", body: turn, headers: auth(accessToken) },
  );
}
