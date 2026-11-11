import { request } from "@/shared/api/client";

import type {
  MeetupAreasResponse,
  MeetupCreateRequest,
  MeetupCreateResponse,
  MeetupSnapshot,
  ProfileCreateRequest,
  ProfileCreateResponse,
  Taste,
} from "../model/meetup";

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

// 모임장만 다른 사람의 프로필을 지운다(AC-23)
export function removeProfile(code: string, profileId: number) {
  return request<void>(`/v1/meetups/${code}/profiles/${profileId}`, {
    method: "DELETE",
  });
}
