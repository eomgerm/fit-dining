import type { Metadata } from "next";

import { isMeetupCode } from "@/domains/meetup/model/meetup";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";

import { MeetupScreen } from "../meetup-screen";

export const instant = false;

export const metadata: Metadata = { title: "내 이름 고르기" };

// 프로필 고르기(/m/<코드>/profiles). 다 찬 모임이나 이미 있는 이름에서 "내 이름 고르기"로 들어온다
export default async function MeetupProfilesPage({
  params,
}: PageProps<"/m/[code]/profiles">) {
  const { code } = await params;
  if (!isMeetupCode(code)) return <MeetupNotFound />;
  return <MeetupScreen code={code} view="profiles" />;
}
