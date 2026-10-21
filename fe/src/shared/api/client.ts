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

// 브라우저에서 같은 출처의 /api로 BE를 호출한다(design.md 12.5 #2).
// 호출자가 취소하면 AbortError를 그대로 던지고, 나머지 실패는 ApiError로 던진다.
export async function request<T>(
  path: string,
  {
    method = "GET",
    query,
    body,
    headers,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: RequestOptions = {},
): Promise<T> {
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
    return (await readJson(response)) as T;
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
  return `/api${path}${search ? `?${search}` : ""}`;
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
