"use client";
import { clearAnswers, readAnswers } from "@/domains/onboarding/model/storage";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthError, socialSignup } from "@/domains/auth/api/auth-client";
import { signupFailure } from "@/domains/auth/api/signup-error";
import { SignupTerms } from "@/domains/auth/ui/signup-terms";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
export default function SocialSignupPage() {
  const router = useRouter();
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [agreements, setAgreements] = useState({
    ageOver14: false,
    terms: false,
    privacy: false,
  });
  async function start() {
    if (submitting.current || !Object.values(agreements).every(Boolean)) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const preferences = readAnswers();
      await socialSignup({
        agreements,
        ...(preferences ? { preferences } : {}),
      });
      clearAnswers();
      router.replace("/location");
    } catch (failure) {
      if (failure instanceof AuthError && failure.status === 401) {
        router.replace("/signup?error=social");
        return;
      }
      const parsed = signupFailure(failure);
      setMessage(parsed.message);
      setOpen(false);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-110 flex-col bg-surface px-5 pb-6 text-ink sm:px-8">
      <header className="-mx-3 flex min-h-14 items-center gap-2">
        <IconButton
          label="회원가입으로 돌아가기"
          role="link"
          nativeButton={false}
          render={<Link href="/signup" />}
        >
          <ChevronLeftIcon />
        </IconButton>
        <h1 className="text-title-md">핏다이닝 시작하기</h1>
      </header>
      <div aria-busy={busy} className="mt-6 flex flex-1 flex-col gap-4">
        {message && (
          <p role="alert" className="text-caption-md text-danger">
            {message}
          </p>
        )}
        <Button
          onClick={() => setOpen(true)}
          className="mt-auto w-full"
          disabled={busy}
        >
          약관 동의하고 시작하기
        </Button>
      </div>
      <SignupTerms
        open={open}
        setOpen={setOpen}
        busy={busy}
        agreements={agreements}
        setAgreements={setAgreements}
        start={start}
      />
    </main>
  );
}
