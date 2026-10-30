import { describe, expect, it } from "vitest";
import { installPlatform } from "./platform";

const iphoneSafari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const iphoneChrome =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.0.0 Mobile/15E148 Safari/604.1";
// iPadOS Safari는 데스크톱 Mac과 같은 UA를 보낸다
const macLike =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const galaxyChrome =
  "Mozilla/5.0 (Linux; Android 15; SM-S931N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
const samsungInternet =
  "Mozilla/5.0 (Linux; Android 15; SM-S931N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36";

describe("installPlatform", () => {
  it.each([
    ["아이폰 Safari", iphoneSafari, 5],
    ["아이폰 Chrome", iphoneChrome, 5],
    ["아이패드(Mac UA + 터치)", macLike, 5],
  ])("%s는 iOS 안내를 쓴다", (_, userAgent, touchPoints) => {
    expect(installPlatform(userAgent, touchPoints)).toBe("ios");
  });

  it.each([
    ["갤럭시 Chrome", galaxyChrome, 5],
    ["삼성 인터넷", samsungInternet, 5],
    ["터치 없는 Mac", macLike, 0],
  ])("%s는 Android 안내를 쓴다", (_, userAgent, touchPoints) => {
    expect(installPlatform(userAgent, touchPoints)).toBe("android");
  });
});
