import type { Metadata } from "next";
import type { ReactNode } from "react";

// 모임 화면은 검색에 걸리지 않고 다른 사이트로 모임 주소를 넘기지 않는다(meetup AC-66).
// 한글 줄바꿈은 모임 화면의 최상위에만 건다. 기존 화면은 바뀌지 않는다(PRD §7.4)
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function MeetupLayout({ children }: { children: ReactNode }) {
  return <div className="text-pretty break-keep">{children}</div>;
}
