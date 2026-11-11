import type { Metadata } from "next";

import { isMeetupCode } from "@/domains/meetup/model/meetup";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";

import { MeetupScreen } from "./meetup-screen";

export const instant = false;

export const metadata: Metadata = { title: "모임 장소 정하기" };

// 모임 링크(/m/<코드>). 형식이 틀린 코드는 서버에 묻지 않고 없는 링크 화면을 보인다(AC-65)
export default async function MeetupPage({ params }: PageProps<"/m/[code]">) {
  const { code } = await params;
  if (!isMeetupCode(code)) return <MeetupNotFound />;
  return <MeetupScreen code={code} />;
}
