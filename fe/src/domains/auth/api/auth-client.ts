"use client";

import type { SignupPreferences } from "../model/signup";

export type AuthSession = {
  userId: string;
  accessToken: string;
  nickname: string;
  sessionId: string;
  accessExpiresAt: number;
  sessionExpiresAt: number;
};
export { ApiError as AuthError } from "@/shared/api/api-error";
import {
  ApiError as AuthError,
  type ProblemDetail,
} from "@/shared/api/api-error";
export const ACCESS_TOKEN_EXPIRED_TYPE =
  "urn:fitdining:auth:access-token-expired";
let session: AuthSession | null = null;
let pendingRefresh: Promise<AuthSession> | null = null;
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();
function update(value: AuthSession | null) {
  session = value;
  listeners.forEach((listener) => listener());
}
function connectChannel() {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("fitdining-auth");
    channel.onmessage = () => update(null);
  }
}
export function subscribe(listener: () => void) {
  connectChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getSession = () => session;
export function clearSession() {
  update(null);
}
// 서버에서 세션이 끝났을 때(예: 탈퇴) 메모리 세션을 비우고 다른 탭에도 알린다
export function endSession() {
  connectChannel();
  update(null);
  channel?.postMessage("session-changed");
}

async function browserLock<T>(work: () => Promise<T>) {
  connectChannel();
  if (!navigator.locks)
    throw new AuthError(
      "http",
      "인증에는 Web Locks를 지원하는 브라우저와 HTTPS 또는 localhost가 필요합니다.",
      { status: 0 },
    );
  return navigator.locks.request("fitdining-auth-cookie", work);
}
async function send<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      ...options,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new AuthError("network", "서버에 연결할 수 없습니다.");
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = body as ProblemDetail | null;
    throw new AuthError(
      "http",
      problem?.detail ?? "요청을 처리하지 못했습니다.",
      {
        status: response.status,
        problem: problem ?? undefined,
      },
    );
  }
  return body as T;
}
export async function login(email: string, password: string) {
  return browserLock(async () => {
    const next = await send<AuthSession>("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    update(next);
    channel?.postMessage("session-changed");
    return next;
  });
}
export type SignupRequest = {
  preferences?: SignupPreferences;
  email: string;
  password: string;
  nickname: string;
  agreements: { ageOver14: boolean; terms: boolean; privacy: boolean };
  // 이메일 인증 확인으로 받은 1회용 토큰. 메모리에만 두고 storage에 저장하지 않는다
  verificationToken: string;
};
export type EmailVerificationRequested = {
  expiresAt: string;
  resendAvailableAt: string;
};
export type EmailVerificationConfirmed = {
  verificationToken: string;
  expiresAt: string;
};
// 가입 전 이메일 소유 확인. 쿠키를 다루지 않아 브라우저 잠금 없이 보낸다
export async function requestEmailVerification(email: string) {
  return send<EmailVerificationRequested>("/email-verifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}
export async function confirmEmailVerification(email: string, code: string) {
  return send<EmailVerificationConfirmed>("/email-verifications/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), code }),
  });
}
export async function signup(body: SignupRequest) {
  return browserLock(async () => {
    const next = await send<AuthSession>("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        email: body.email.trim().toLowerCase(),
        nickname: body.nickname.trim(),
      }),
    });
    update(next);
    channel?.postMessage("session-changed");
    return next;
  });
}
export async function socialSignup(
  body: Pick<SignupRequest, "agreements" | "preferences">,
) {
  return browserLock(async () => {
    const next = await send<AuthSession>("/social/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agreements: body.agreements,
        ...(body.preferences ? { preferences: body.preferences } : {}),
      }),
    });
    update(next);
    channel?.postMessage("session-changed");
    return next;
  });
}
export function refresh(): Promise<AuthSession> {
  if (!pendingRefresh) {
    pendingRefresh = browserLock(async () => {
      try {
        const next = await send<AuthSession>("/refresh", { method: "POST" });
        update(next);
        return next;
      } catch (error) {
        if (error instanceof AuthError && error.status === 401) {
          update(null);
          channel?.postMessage("session-changed");
        }
        throw error;
      }
    }).finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}
export async function restore() {
  return session ?? refresh();
}
export async function logout() {
  return browserLock(async () => {
    try {
      await send<void>("/logout", {
        method: "POST",
      });
      update(null);
      channel?.postMessage("session-changed");
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        update(null);
        channel?.postMessage("session-changed");
      }
      throw error;
    }
  });
}
