import { useMutation, useQuery } from "@tanstack/react-query";

import { isApiError } from "@/shared/api/api-error";

import type { MeetupCreateRequest } from "../model/meetup";
import { createMeetup, fetchSnapshot, searchAreas } from "./meetup-api";

// 로그인을 확인하고 요청을 보내는 함수. 모임 도메인은 인증 도메인을 부를 수 없어 app이 만들어 넘긴다
export type WithSession = <T>(send: () => Promise<T>) => Promise<T>;

export const meetupKeys = {
  all: ["meetups"] as const,
  areas: (query: string) => [...meetupKeys.all, "areas", query] as const,
  snapshot: (code: string) => [...meetupKeys.all, "snapshot", code] as const,
};

export function useAreaSearch(query: string, withSession: WithSession) {
  return useQuery({
    queryKey: meetupKeys.areas(query),
    queryFn: ({ signal }) => withSession(() => searchAreas(query, signal)),
    enabled: query.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useCreateMeetup(withSession: WithSession) {
  return useMutation({
    mutationFn: (body: MeetupCreateRequest) =>
      withSession(() => createMeetup(body)),
  });
}

// 화면에 들어올 때와 탭으로 돌아올 때 다시 받는다(AC-31). 없는 코드(404)는 다시 묻지 않는다
export function useMeetupSnapshot(code: string) {
  return useQuery({
    queryKey: meetupKeys.snapshot(code),
    queryFn: ({ signal }) => fetchSnapshot(code, signal),
    retry: (count, error) =>
      !(isApiError(error) && error.status === 404) && count < 2,
  });
}

export function isNotFound(error: unknown) {
  return isApiError(error) && error.status === 404;
}
