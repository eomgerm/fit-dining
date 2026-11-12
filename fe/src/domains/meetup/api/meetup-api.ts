import { request } from "@/shared/api/client";

import type {
  MeetupAreaCheck,
  MeetupAreasResponse,
  MeetupCreateRequest,
  MeetupCreateResponse,
  MeetupSnapshot,
  MeetupUpdateRequest,
  PollOpenRequest,
  ProfileCreateRequest,
  ProfileCreateResponse,
  Taste,
} from "../model/meetup";
import type { MeetupResult } from "../model/result";

// 로그인한 회원만 모임을 만든다(AC-1)
export function createMeetup(body: MeetupCreateRequest) {
  return request<MeetupCreateResponse>("/v1/meetups", { method: "POST", body });
}

// 장소가 있는 역·동을 찾는다. 로그인이 필요하다
export function searchAreas(query: string, signal?: AbortSignal) {
  return request<MeetupAreasResponse>("/v1/meetups/areas", {
    query: { q: query },
    signal,
  });
}

// 지점과 반경 안의 장소 수와 붙일 이름. 로그인이 필요하다(AC-58)
export function checkArea(
  point: { lat: number; lng: number; radiusM: number },
  signal?: AbortSignal,
) {
  return request<MeetupAreaCheck>("/v1/meetups/area-check", {
    query: {
      lat: String(point.lat),
      lng: String(point.lng),
      radiusM: String(point.radiusM),
    },
    signal,
  });
}

// 모임의 지금 상태. 로그인과 프로필 없이도 받는다(AC-3). 모임 쿠키는 브라우저가 싣는다
export function fetchSnapshot(code: string, signal?: AbortSignal) {
  return request<MeetupSnapshot>(`/v1/meetups/${code}`, { signal });
}

// 이름과 취향을 남긴다. 응답이 모임 쿠키를 준다(AC-5, AC-7)
export function createProfile(code: string, body: ProfileCreateRequest) {
  return request<ProfileCreateResponse>(`/v1/meetups/${code}/profiles`, {
    method: "POST",
    body,
  });
}

// 다른 브라우저에서 자기 이름을 고른다(AC-8)
export function selectProfile(code: string, profileId: number) {
  return request<void>(`/v1/meetups/${code}/profiles/${profileId}/session`, {
    method: "POST",
  });
}

export function updateTaste(code: string, taste: Taste) {
  return request<void>(`/v1/meetups/${code}/profiles/me/taste`, {
    method: "PUT",
    body: taste,
  });
}

// 모임장이 모임 정보를 고친다(AC-22)
export function updateMeetup(code: string, body: MeetupUpdateRequest) {
  return request<void>(`/v1/meetups/${code}`, { method: "PATCH", body });
}

// 모임장이 추천받는다. 계산은 서버가 따로 하고 끝났는지는 스냅숏으로 안다(AC-15, D-10)
export function startCalculation(code: string) {
  return request<void>(`/v1/meetups/${code}/calculations`, { method: "POST" });
}

// 마지막으로 성공한 계산의 결과(AC-19). 로그인 없이 받는다
export function fetchResult(code: string, signal?: AbortSignal) {
  return request<MeetupResult>(`/v1/meetups/${code}/result`, { signal });
}

// 모임장이 결과 안의 2~5곳으로 투표를 연다(AC-36)
export function openPoll(code: string, body: PollOpenRequest) {
  return request<void>(`/v1/meetups/${code}/poll`, { method: "POST", body });
}

// 프로필이 있는 사람이 투표하거나 표를 바꾼다(AC-37). 로그인 없이 된다
export function vote(code: string, placeId: number) {
  return request<void>(`/v1/meetups/${code}/poll/votes/me`, {
    method: "PUT",
    body: { placeId },
  });
}

// 마감한다. 가장 많은 곳이 하나면 정해지고, 동점이면 닫힌 채 모임장의 선택을 기다린다(AC-40)
export function closePoll(code: string) {
  return request<void>(`/v1/meetups/${code}/poll/close`, { method: "POST" });
}

// 동점으로 닫힌 투표를 다시 연다(AC-40)
export function reopenPoll(code: string) {
  return request<void>(`/v1/meetups/${code}/poll/reopen`, { method: "POST" });
}

// 정하거나 다른 곳으로 바꾼다(AC-41)
export function decide(code: string, placeId: number) {
  return request<void>(`/v1/meetups/${code}/decision`, {
    method: "PUT",
    body: { placeId },
  });
}

// 정하기 취소(AC-41)
export function cancelDecision(code: string) {
  return request<void>(`/v1/meetups/${code}/decision`, { method: "DELETE" });
}

// 모임장만 다른 사람의 프로필을 지운다(AC-23)
export function removeProfile(code: string, profileId: number) {
  return request<void>(`/v1/meetups/${code}/profiles/${profileId}`, {
    method: "DELETE",
  });
}
