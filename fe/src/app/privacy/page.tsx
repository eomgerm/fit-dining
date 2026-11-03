"use client";

import { termsContent } from "@/domains/auth/model/terms-content";
import { TermsBody } from "@/domains/auth/ui/terms-body";
import { useRouter } from "next/navigation";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

export default function PrivacyPage() {
  const router = useRouter();
  const content = termsContent.privacy;
  return (
    <Screen>
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
      <div className="px-5 pt-6 pb-safe-6">
        <TermsBody content={content} headingLevel={2} />
      </div>
    </Screen>
  );
}
