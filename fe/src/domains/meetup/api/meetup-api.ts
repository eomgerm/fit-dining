import { request } from "@/shared/api/client";

import type {
  MeetupAreasResponse,
  MeetupCreateRequest,
  MeetupCreateResponse,
  MeetupSnapshot,
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

// 모임의 지금 상태. 로그인과 프로필 없이도 받는다(AC-3)
export function fetchSnapshot(code: string, signal?: AbortSignal) {
  return request<MeetupSnapshot>(`/v1/meetups/${code}`, { signal });
}
