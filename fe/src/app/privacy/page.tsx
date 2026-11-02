"use client";

import { termsContent } from "@/domains/auth/model/terms-content";
import { TermsBody } from "@/domains/auth/ui/terms-body";
import { useRouter } from "next/navigation";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { TopBar } from "@/shared/ui/layout/top-bar";

export default function PrivacyPage() {
  const router = useRouter();
  const content = termsContent.privacy;
  return (
    <main className="mx-auto min-h-svh w-full max-w-110 bg-surface text-ink">
      <TopBar
        title={content.title}
        start={
          <IconButton
            label="뒤로가기"
            onClick={() =>
              window.history.length > 1 ? router.back() : router.replace("/")
            }
          >
            <ChevronLeftIcon />
          </IconButton>
        }
      />
      <div className="px-5 py-6">
        <TermsBody content={content} headingLevel={2} />
      </div>
    </main>
  );
}
