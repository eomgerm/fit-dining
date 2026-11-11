import type { Metadata } from "next";

import { isMeetupCode } from "@/domains/meetup/model/meetup";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";

import { EditScreen } from "./edit-screen";

export const instant = false;

export const metadata: Metadata = { title: "모임 정보 수정" };

// 모임 정보 수정(/m/<코드>/edit)
export default async function MeetupEditPage({
  params,
}: PageProps<"/m/[code]/edit">) {
  const { code } = await params;
  if (!isMeetupCode(code)) return <MeetupNotFound />;
  return <EditScreen code={code} />;
}
