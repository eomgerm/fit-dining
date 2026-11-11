import type { Metadata } from "next";

import { isMeetupCode } from "@/domains/meetup/model/meetup";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";

import { JoinScreen } from "./join-screen";

export const instant = false;

export const metadata: Metadata = { title: "모임 참여하기" };

// 질문지(/m/<코드>/join)
export default async function MeetupJoinPage({
  params,
}: PageProps<"/m/[code]/join">) {
  const { code } = await params;
  if (!isMeetupCode(code)) return <MeetupNotFound />;
  return <JoinScreen code={code} />;
}
