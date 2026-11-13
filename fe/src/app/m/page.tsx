import type { Metadata } from "next";

import { MeetupListScreen } from "./meetup-list-screen";

export const metadata: Metadata = { title: "내 모임" };

// 내 모임(/m). 세션은 브라우저에서 확인한다
export default function MeetupListPage() {
  return <MeetupListScreen />;
}
