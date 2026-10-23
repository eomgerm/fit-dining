import { connection } from "next/server";

// 이미지를 다시 빌드하지 않고 환경마다 다른 값을 브라우저에 넘긴다.
// cacheComponents에서는 GET도 빌드 때 미리 렌더링될 수 있어 connection()으로 요청 때 읽는다
export async function GET() {
  await connection();
  const env =
    process.env.APP_ENV ||
    (process.env.NODE_ENV !== "production" ? "dev" : undefined);
  if (env !== "dev" && env !== "prod") {
    return Response.json(
      { error: "Invalid runtime configuration" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  const naverMapClientId = process.env.NAVER_MAP_CLIENT_ID;
  const posthogKey = process.env.POSTHOG_KEY;
  const posthogHost = process.env.POSTHOG_HOST;
  const pushPublicKey = process.env.PUSH_PUBLIC_KEY;
  return Response.json(
    {
      env,
      ...(posthogKey && { posthogKey }),
      ...(posthogHost && { posthogHost }),
      ...(pushPublicKey && { pushPublicKey }),
      ...(naverMapClientId && { naverMapClientId }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
