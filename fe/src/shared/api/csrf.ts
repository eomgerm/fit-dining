import { ApiError } from "./api-error";

let pending: Promise<void> | null = null;
function token() {
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("XSRF-TOKEN="))
    ?.slice("XSRF-TOKEN=".length);
  return value ? decodeURIComponent(value) : undefined;
}

// Only same-origin browser BE requests use this helper. Garage and Next server calls do not.
export async function csrfHeaders(
  method: string,
  initial?: HeadersInit,
): Promise<Headers> {
  const headers = new Headers(initial);
  if (typeof window === "undefined" || /^(GET|HEAD|OPTIONS)$/i.test(method))
    return headers;
  if (!token()) {
    pending ??= (async () => {
      const response = await fetch("/api/auth/csrf", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new ApiError("http", "인증 요청을 준비하지 못했습니다", {
          status: response.status,
        });
    })().finally(() => {
      pending = null;
    });
    await pending;
  }
  const value = token();
  if (!value)
    throw new ApiError("http", "인증 쿠키를 확인할 수 없습니다", { status: 0 });
  headers.set("X-XSRF-TOKEN", value);
  return headers;
}
