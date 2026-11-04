import { ApiError, type ProblemDetail } from "./api-error";

type QueryValue = string | number | boolean | undefined;

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: HeadersInit;
  // TanStack Query가 넘겨주는 취소 신호
  signal?: AbortSignal;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

// 브라우저에서 같은 출처의 /api로 BE를 호출한다. Next 서버에서는 BE_INTERNAL_URL로 부른다(design.md 12.5 #2).
// 호출자가 취소하면 AbortError를 그대로 던지고, 나머지 실패는 ApiError로 던진다.
export async function request<T>(
  path: string,
  options?: RequestOptions,
): Promise<T> {
  return (await requestWithHeaders<T>(path, options)).data;
}

// request와 같고, 성공한 응답의 헤더도 돌려준다
export async function requestWithHeaders<T>(
  path: string,
  {
    method = "GET",
    query,
    body,
    headers,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: RequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
  }
  // try 밖에서 직렬화해야 순환 참조 같은 TypeError가 network 오류로 바뀌지 않는다
  const requestBody = body === undefined ? undefined : JSON.stringify(body);

  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: signal ? anySignal(signal, timeout) : timeout,
    });

    if (!response.ok) throw await toHttpError(response);
    return { data: (await readJson(response)) as T, headers: response.headers };
  } catch (error) {
    throw toFetchError(error);
  }
}

// AbortSignal.any 대신 쓴다. Next 16 기본 대상(Safari 16.4, Chrome 111)에 없다
function anySignal(...signals: AbortSignal[]) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
      signal: controller.signal,
    });
  }
  return controller.signal;
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.append(key, String(value));
  }
  const search = params.toString();
  return `${serverOrigin()}/api${path}${search ? `?${search}` : ""}`;
}

// Next 서버에서의 호출(서버 컴포넌트)은 Caddy 내부 리스너로 BE를 부른다(design.md 12.5 #2).
// NEXT_RUNTIME은 Next 서버에서만 있다. 기본 주소는 두지 않는다(번들에 로컬 주소 금지, check_fe_bundle.py).
// 값이 없으면 서버의 상대 경로 요청이 network 오류로 끝나고 화면은 브라우저가 다시 받는다
function serverOrigin() {
  if (typeof window !== "undefined" || !process.env.NEXT_RUNTIME) return "";
  return process.env.BE_INTERNAL_URL ?? "";
}

// 204처럼 본문이 비어 있으면 undefined
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function toHttpError(response: Response) {
  const problem = await readProblem(response);
  const message =
    problem?.detail ?? problem?.title ?? `HTTP ${response.status}`;
  return new ApiError("http", message, { status: response.status, problem });
}

// application/json과 application/problem+json 모두 JSON으로 읽는다.
// JSON이 깨졌으면 undefined. 읽는 중의 취소·timeout은 그대로 던진다
async function readProblem(
  response: Response,
): Promise<ProblemDetail | undefined> {
  if (!response.headers.get("Content-Type")?.includes("json")) return;
  try {
    return (await response.json()) as ProblemDetail;
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
}

function toFetchError(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ApiError("timeout", "요청 시간이 초과되었습니다", {
      cause: error,
    });
  }
  // fetch는 연결 실패를 TypeError로 알린다
  if (error instanceof TypeError) {
    return new ApiError("network", "서버에 연결하지 못했습니다", {
      cause: error,
    });
  }
  return error;
}
