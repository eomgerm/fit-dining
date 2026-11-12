import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { isApiError } from "@/shared/api/api-error";

import type {
  MeetupConflict,
  MeetupCreateRequest,
  MeetupUpdateRequest,
  PollOpenRequest,
  ProfileCreateRequest,
  Taste,
} from "../model/meetup";
import {
  cancelDecision,
  checkArea,
  closePoll,
  createMeetup,
  createProfile,
  decide,
  fetchResult,
  fetchSnapshot,
  openPoll,
  removeProfile,
  reopenPoll,
  searchAreas,
  selectProfile,
  startCalculation,
  updateMeetup,
  updateTaste,
  vote,
} from "./meetup-api";

// 로그인을 확인하고 요청을 보내는 함수. 모임 도메인은 인증 도메인을 부를 수 없어 app이 만들어 넘긴다
export type WithSession = <T>(send: () => Promise<T>) => Promise<T>;

// 스냅숏의 키는 ["meetups", 코드]다(D-21). 지역 찾기 키의 "areas"는 22자 코드와 겹치지 않는다
export const meetupKeys = {
  all: ["meetups"] as const,
  areas: (query: string) => [...meetupKeys.all, "areas", query] as const,
  areaCheck: (lat: number, lng: number, radiusM: number) =>
    [...meetupKeys.all, "area-check", lat, lng, radiusM] as const,
  snapshot: (code: string) => [...meetupKeys.all, code] as const,
  // 결과는 계산마다 바뀌지 않아 스냅숏과 다른 키에 둔다. 스냅숏을 다시 받을 때 함께 다시 받지 않는다
  result: (code: string, calculationId: number) =>
    ["meetup-results", code, calculationId] as const,
};

// 계산 중에 스냅숏을 다시 받는 간격(D-10)
export const CALCULATING_REFETCH_MS = 1000;
// 투표 중에 스냅숏을 다시 받는 간격(D-21)
export const VOTING_REFETCH_MS = 5000;

export function useAreaSearch(query: string, withSession: WithSession) {
  return useQuery({
    queryKey: meetupKeys.areas(query),
    queryFn: ({ signal }) => withSession(() => searchAreas(query, signal)),
    enabled: query.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

// 지도의 지점과 반경 안 장소 수. 지점은 소수 넷째 자리(약 10m)로 맞춰 같은 곳을 다시 묻지 않는다
export function useAreaCheck(
  point: { lat: number; lng: number; radiusM: number } | null,
  withSession: WithSession,
) {
  const lat = point ? Math.round(point.lat * 1e4) / 1e4 : 0;
  const lng = point ? Math.round(point.lng * 1e4) / 1e4 : 0;
  const radiusM = point?.radiusM ?? 0;
  return useQuery({
    queryKey: meetupKeys.areaCheck(lat, lng, radiusM),
    queryFn: ({ signal }) =>
      withSession(() => checkArea({ lat, lng, radiusM }, signal)),
    enabled: point !== null,
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

// 화면에 들어올 때와 탭으로 돌아올 때 다시 받고, 계산 중에는 1초, 투표 중에는 5초마다 다시 받는다(AC-31, AC-43).
// 투표 중에는 동점으로 닫혀 모임장을 기다리는 동안도 받아, 다시 열거나 정한 것이 참여자에게 늦지 않게 한다
// 없는 코드(404)는 다시 묻지 않는다
export function useMeetupSnapshot(code: string) {
  return useQuery({
    queryKey: meetupKeys.snapshot(code),
    queryFn: ({ signal }) => fetchSnapshot(code, signal),
    retry: (count, error) =>
      !(isApiError(error) && error.status === 404) && count < 2,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.calculation?.state === "RUNNING") return CALCULATING_REFETCH_MS;
      return data?.phase === "VOTING" ? VOTING_REFETCH_MS : false;
    },
  });
}

// 마지막으로 성공한 계산의 결과. 그 계산 번호가 바뀔 때만 받는다(D-9)
export function useMeetupResult(code: string, calculationId?: number) {
  return useQuery({
    queryKey: meetupKeys.result(code, calculationId ?? 0),
    queryFn: ({ signal }) => fetchResult(code, signal),
    enabled: calculationId !== undefined,
    staleTime: Infinity,
  });
}

// 모임 쓰기는 리뷰와 같은 규칙이다. 꺼진 네트워크에서도 바로 실패를 알리고, 재시도하지 않고, 끝나면 스냅숏을 다시 받는다(D-21)
function useMeetupWrite<T, R>(code: string, send: (input: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: send,
    networkMode: "always",
    retry: false,
    onSettled: () =>
      client.invalidateQueries({ queryKey: meetupKeys.snapshot(code) }),
  });
}

export function useCreateProfile(code: string) {
  return useMeetupWrite(code, (body: ProfileCreateRequest) =>
    createProfile(code, body),
  );
}

export function useSelectProfile(code: string) {
  return useMeetupWrite(code, (profileId: number) =>
    selectProfile(code, profileId),
  );
}

export function useUpdateTaste(code: string) {
  return useMeetupWrite(code, (taste: Taste) => updateTaste(code, taste));
}

export function useUpdateMeetup(code: string) {
  return useMeetupWrite(code, (body: MeetupUpdateRequest) =>
    updateMeetup(code, body),
  );
}

export function useStartCalculation(code: string) {
  return useMeetupWrite<void, void>(code, () => startCalculation(code));
}

export function useOpenPoll(code: string) {
  return useMeetupWrite(code, (body: PollOpenRequest) => openPoll(code, body));
}

export function useVote(code: string) {
  return useMeetupWrite(code, (placeId: number) => vote(code, placeId));
}

export function useClosePoll(code: string) {
  return useMeetupWrite<void, void>(code, () => closePoll(code));
}

export function useReopenPoll(code: string) {
  return useMeetupWrite<void, void>(code, () => reopenPoll(code));
}

export function useDecide(code: string) {
  return useMeetupWrite(code, (placeId: number) => decide(code, placeId));
}

export function useCancelDecision(code: string) {
  return useMeetupWrite<void, void>(code, () => cancelDecision(code));
}

export function useRemoveProfile(code: string) {
  return useMeetupWrite(code, (profileId: number) =>
    removeProfile(code, profileId),
  );
}

export function isNotFound(error: unknown) {
  return isApiError(error) && error.status === 404;
}

// 409의 종류. 다른 실패면 undefined다
export function conflictOf(error: unknown): MeetupConflict | undefined {
  if (!isApiError(error) || error.status !== 409) return undefined;
  const type = error.problem?.type;
  return typeof type === "string" && type.startsWith("urn:fitdining:meetup:")
    ? (type.slice("urn:fitdining:meetup:".length) as MeetupConflict)
    : undefined;
}
