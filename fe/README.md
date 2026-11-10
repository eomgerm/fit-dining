프론트 관련 작업을 진행할 디렉토리입니다.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

HTTP 로컬 실행에서는 BE 환경변수를 `AUTH_COOKIE_SECURE=false`로 설정해야 세션·CSRF 쿠키가 저장되고 비회원 검색도 동작합니다.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## 배포 계약

`DEPLOYMENT_VERSION=<commit-sha> pnpm build`로 standalone 번들을 만든다.
커밋 SHA를 build ID와 deployment ID로 사용하며, 생략하면 Next 기본 동작을 따른다.
이미지 최적화는 꺼서 Arm에서 빌드한 번들을 x86에서도 사용한다.

`.next/standalone`에 `.next/static`을 같은 상대 경로로 복사하고, 필요한 `public` 자산도 복사한다.
standalone 디렉터리에서 `node server.js`로 실행한다. 컨테이너는 `NODE_ENV=production`,
`PORT=3000`, `HOSTNAME=0.0.0.0`을 사용한다. 같은 번들을 dev와 prod에 배포한다.

환경별 값은 `NEXT_PUBLIC_*`로 빌드에 넣지 않고 런타임 환경변수로 전달한다.
`GET /config.json`은 요청마다 공개 값만 읽으며 캐시하지 않는다.
`APP_ENV`는 `dev` 또는 `prod`여야 한다. production에서 누락되거나 어느 환경에서든 잘못된 값이면
내부 정보를 노출하지 않고 500을 반환한다. 로컬 개발에서는 생략하면 `dev`다.

| 환경변수              | 응답 키            | 필수                |
| --------------------- | ------------------ | ------------------- |
| `APP_ENV`             | `env`              | production에서 필수 |
| `POSTHOG_KEY`         | `posthogKey`       | 선택                |
| `POSTHOG_HOST`        | `posthogHost`      | 선택                |
| `PUSH_PUBLIC_KEY`     | `pushPublicKey`    | 선택                |
| `NAVER_MAP_CLIENT_ID` | `naverMapClientId` | 선택                |

선택 값은 비어 있으면 응답에서 생략한다. `BE_INTERNAL_URL` 등 비밀값과 내부 주소는 공개하지 않는다.
`NAVER_MAP_CLIENT_ID`는 기존 공개 설정으로 유지하며 인프라 env 계약에는 아직 없다.

`GET /fe-healthz`는 BE 등 외부 의존성을 조회하지 않고 200, `text/plain` 본문 `ok`,
`Cache-Control: no-store`를 반환한다.

쿠키는 호스트별로 격리하도록 `Domain` 속성을 지정하지 않는다. 인증 쿠키는 `HttpOnly`와 `Secure`를 사용한다.
현재 FE에는 쿠키 설정 코드가 없으며, 로그인 브랜치를 합칠 때 이 규칙을 다시 확인해야 한다.
상세 계약은 [인프라 설계](../docs/infra/design.md)의 12.5절과
[환경변수 계약](../docs/infra/contracts/env.md)을 따른다.
