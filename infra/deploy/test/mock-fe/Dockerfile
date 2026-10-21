FROM node:22-alpine
ARG SHA
ARG MODE=ok
ENV MOCK_SHA=$SHA MOCK_MODE=$MODE
WORKDIR /app
COPY server.js /app/server.js
# 실제 FE 이미지처럼 정적 자산이 /app/.next/static에 있다. app-<sha 7자리>.js는 릴리스마다 다르고 shared.js는 모든 릴리스가 같다
RUN mkdir -p .next/static/chunks \
 && echo "// app $SHA" > ".next/static/chunks/app-$(printf '%.7s' "$SHA").js" \
 && echo "// shared" > .next/static/chunks/shared.js
CMD ["node", "server.js"]
