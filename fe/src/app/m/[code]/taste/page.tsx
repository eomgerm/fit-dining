import type { Metadata } from "next";

import { isMeetupCode } from "@/domains/meetup/model/meetup";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";

import { TasteScreen } from "./taste-screen";

export const instant = false;

export const metadata: Metadata = { title: "내 취향 수정" };

// 내 취향 수정(/m/<코드>/taste)
export default async function MeetupTastePage({
  params,
}: PageProps<"/m/[code]/taste">) {
  const { code } = await params;
  if (!isMeetupCode(code)) return <MeetupNotFound />;
  return <TasteScreen code={code} />;
}
