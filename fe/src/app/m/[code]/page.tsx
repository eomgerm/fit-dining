import type { Metadata } from "next";

import { isMeetupCode } from "@/domains/meetup/model/meetup";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";

import { loadPreview } from "./load-preview";
import { MeetupScreen } from "./meetup-screen";
import { meetupMetadata } from "./meetup-seo";

export const instant = false;

// 단톡방에 붙인 링크의 미리보기(AC-66). 형식이 틀린 코드는 서버에 묻지 않고 일반 안내다
export async function generateMetadata({
  params,
}: PageProps<"/m/[code]">): Promise<Metadata> {
  const { code } = await params;
  return meetupMetadata(
    isMeetupCode(code) ? await loadPreview(code) : "not-found",
  );
}

// 모임 링크(/m/<코드>). 형식이 틀린 코드는 서버에 묻지 않고 없는 링크 화면을 보인다(AC-65)
export default async function MeetupPage({ params }: PageProps<"/m/[code]">) {
  const { code } = await params;
  if (!isMeetupCode(code)) return <MeetupNotFound />;
  return <MeetupScreen code={code} />;
}
