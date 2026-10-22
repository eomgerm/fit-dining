// GET /config.json(src/app/config.json/route.ts)이 돌려주는 실행 환경 값
export type RuntimeConfig = {
  env: string;
  naverMapClientId?: string;
};

let pending: Promise<RuntimeConfig | undefined> | undefined;

// 페이지 세션에 한 번만 받아 메모리에 둔다. 받지 못하면 undefined이고 다시 요청하지 않는다
export function loadRuntimeConfig() {
  pending ??= fetch("/config.json")
    .then((response) =>
      response.ok ? (response.json() as Promise<RuntimeConfig>) : undefined,
    )
    .catch(() => undefined);
  return pending;
}
