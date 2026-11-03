import type { Metadata } from "next";
import { termsContent } from "@/domains/auth/model/terms-content";

// page.tsx가 클라이언트 컴포넌트라 metadata를 여기서 내보낸다
export const metadata: Metadata = {
  title: termsContent.privacy.title,
  alternates: { canonical: "/privacy" },
};

export default function Layout({ children }: LayoutProps<"/privacy">) {
  return children;
}
