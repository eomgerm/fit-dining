import { request, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";

// 로컬 next dev에서만 쓰는 리뷰 사진 읽기 경로(리뷰 D-45). 서버에서는 Caddy가 /photos/<env>/confirmed/를
// Garage 웹 엔드포인트로 보내 여기까지 오지 않는다(design.md 5.2).
// Garage 웹 엔드포인트는 Host로 버킷을 찾는데, Node가 *.web.garage.localhost를 찾지 못하고 fetch는 Host를 바꿀 수 없어
// rewrites 대신 Host를 붙여 넘긴다
const PHOTO_NAME = /^[0-9a-f-]{36}(\.thumb)?\.jpg$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ env: string; name: string }> },
) {
  const { name } = await params;
  if (process.env.NODE_ENV !== "development" || !PHOTO_NAME.test(name)) {
    return new Response(null, { status: 404 });
  }
  const origin = process.env.LOCAL_PHOTO_WEB_URL ?? "http://127.0.0.1:13902";
  const bucket = process.env.LOCAL_PHOTO_BUCKET ?? "fit-dev-photos";
  try {
    const upstream = await get(
      new URL(`/confirmed/${name}`, origin),
      `${bucket}.web.garage.localhost`,
    );
    // 본문을 넘기지 않는 응답은 읽어 버려야 연결이 풀로 돌아간다
    if (upstream.statusCode !== 200) upstream.resume();
    return new Response(
      upstream.statusCode === 200
        ? (Readable.toWeb(upstream) as ReadableStream)
        : null,
      {
        status: upstream.statusCode,
        headers: {
          "Content-Type": upstream.headers["content-type"] ?? "image/jpeg",
        },
      },
    );
  } catch {
    return new Response(null, { status: 502 });
  }
}

function get(url: URL, host: string) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    request(url, { headers: { host } }, resolve).on("error", reject).end();
  });
}
