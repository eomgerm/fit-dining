import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { shouldServeStreamingMetadata } from "next/dist/server/lib/streaming-metadata";
import { expect, it } from "vitest";

import nextConfig from "../../next.config";

// Next는 설정의 정규식을 본문(source)만 받아 쓴다
const bots = nextConfig.htmlLimitedBots!.source;

it("카카오톡 스크래퍼는 메타데이터를 스트리밍하지 않고 <head>에 받는다(meetup D-38)", () => {
  for (const userAgent of [
    "kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984",
    "facebookexternalhit/1.1 kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984",
  ]) {
    expect(shouldServeStreamingMetadata(userAgent, bots)).toBe(false);
  }
});

it("Next 기본 목록의 봇도 그대로 <head>에 받는다", () => {
  expect(bots.startsWith(HTML_LIMITED_BOT_UA_RE.source)).toBe(true);
  for (const userAgent of [
    "facebookexternalhit/1.1",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0",
    "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)",
  ]) {
    expect(shouldServeStreamingMetadata(userAgent, bots)).toBe(false);
  }
});

it("카카오톡 안 브라우저와 일반 브라우저는 지금처럼 메타데이터를 스트리밍한다", () => {
  for (const userAgent of [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.8.0",
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  ]) {
    expect(shouldServeStreamingMetadata(userAgent, bots)).toBe(true);
  }
});
