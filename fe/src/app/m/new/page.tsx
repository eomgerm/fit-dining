import type { Metadata } from "next";

import { MeetupNewScreen } from "./meetup-new-screen";

export const metadata: Metadata = { title: "모임 만들기" };

// 모임 만들기(/m/new). 세션은 브라우저에서 확인한다
export default function MeetupNewPage() {
  return <MeetupNewScreen />;
}
