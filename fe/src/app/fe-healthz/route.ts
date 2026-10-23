// BE 장애가 FE 재시작으로 이어지지 않도록 외부 의존성을 조회하지 않는다(design.md 12.5 #6).
export function GET() {
  return new Response("ok", {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    },
  });
}
