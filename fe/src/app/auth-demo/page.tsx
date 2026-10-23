"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AuthError,
  authenticated,
  getSession,
  getServerSession,
  logout,
  refresh,
  restore,
  subscribe,
} from "@/domains/auth/api/auth-client";
import { Button } from "@/shared/ui/button/button";
import { TextButton } from "@/shared/ui/button/text-button";

export default function AuthDemoPage() {
  const router = useRouter();
  const session = useSyncExternalStore(subscribe, getSession, getServerSession);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    restore()
      .then(() => authenticated("/me"))
      .then(() => {
        if (active) setReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof AuthError && error.status === 401)
          router.replace("/login");
        else
          setMessage(
            error instanceof Error
              ? error.message
              : "인증 상태를 확인하지 못했습니다.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [router]);
  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "요청을 처리하지 못했습니다.",
      );
      if (error instanceof AuthError && error.status === 401)
        router.replace("/login");
    } finally {
      setBusy(false);
    }
  }
  const date = (seconds: number) =>
    new Date(seconds * 1000).toLocaleString("ko-KR");
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-110 flex-col bg-surface px-5 pb-6 text-ink sm:border-x sm:border-line sm:px-8">
      <header className="-mx-3 flex min-h-14 items-center justify-between">
        <Link className="ml-3 text-label-sm text-ink-muted" href="/">
          FITDINING
        </Link>
        <span className="text-caption-sm text-ink-muted">인증 확인</span>
      </header>
      <div className="mt-10 mb-7">
        <p className="mb-3 text-label-sm text-primary-strong">MY ACCOUNT</p>
        <h1 className="text-headline-lg">
          반가워요{session ? `, ${session.nickname}님` : ""}.
        </h1>
        <p className="mt-3 text-body-sm text-ink-muted">
          로그인한 계정과 현재 세션을 확인할 수 있어요.
        </p>
      </div>
      {session && (
        <dl className="divide-y divide-line rounded-lg border border-line px-5 py-2">
          <div className="py-4">
            <dt className="mb-1.5 text-caption-sm text-ink-muted">사용자</dt>
            <dd className="text-body-sm wrap-anywhere tabular-nums">
              {session.nickname}
            </dd>
          </div>
          <div className="py-4">
            <dt className="mb-1.5 text-caption-sm text-ink-muted">현재 세션</dt>
            <dd className="text-body-sm wrap-anywhere tabular-nums">
              {session.sessionId}
            </dd>
          </div>
          <div className="py-4">
            <dt className="mb-1.5 text-caption-sm text-ink-muted">
              Access Token 만료 시각
            </dt>
            <dd className="text-body-sm wrap-anywhere tabular-nums">
              {date(session.accessExpiresAt)}
            </dd>
          </div>
          <div className="py-4">
            <dt className="mb-1.5 text-caption-sm text-ink-muted">
              세션 만료 시각
            </dt>
            <dd className="text-body-sm wrap-anywhere tabular-nums">
              {date(session.sessionExpiresAt)}
            </dd>
          </div>
        </dl>
      )}
      <div className="mt-6 grid gap-3">
        <Button
          className="w-full"
          disabled={busy || !session}
          onClick={() =>
            run(() => authenticated("/protected"), "인증에 성공했습니다.")
          }
        >
          인증 API 호출
        </Button>
        <Button
          variant="outline"
          size="md"
          className="w-full"
          disabled={busy || !session}
          onClick={() => run(refresh, "토큰을 갱신했습니다.")}
        >
          토큰 갱신
        </Button>
        <Button
          variant="outline"
          size="md"
          className="w-full"
          disabled={busy || !session}
          onClick={() =>
            run(async () => {
              await logout();
              router.replace("/login");
            }, "로그아웃했습니다.")
          }
        >
          현재 세션 로그아웃
        </Button>
      </div>
      <p
        className={
          busy || message
            ? "mt-2 rounded-md bg-surface-sunken px-3.5 py-3 text-caption-md text-ink-muted"
            : undefined
        }
        role="status"
      >
        {busy ? "처리 중입니다." : message}
      </p>
      <footer className="mt-auto flex justify-center pt-10">
        <TextButton render={<Link href="/login" />}>로그인 페이지</TextButton>
      </footer>
    </main>
  );
}
