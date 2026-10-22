import type { LatLng } from "../model/place-types";
import { searchStore } from "../model/search-store";

const LOCATION_TIMEOUT_MS = 10_000;

function currentPosition() {
  return new Promise<LatLng>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      reject,
      { timeout: LOCATION_TIMEOUT_MS },
    );
  });
}

// 기기 위치를 받아 store에 둔다. 위치는 화면 안에서 거리 계산과 근처 필터에만 쓰고 서버로 보내지 않는다.
// 거부, 오류, 시간 초과면 failed로 두고 undefined를 돌려준다
export async function locateDevice() {
  if (searchStore.getSnapshot().location.status !== "ok") {
    searchStore.setLocation({ status: "pending" });
  }
  try {
    const here = await currentPosition();
    searchStore.setLocation({ status: "ok", here });
    return here;
  } catch {
    searchStore.setLocation({ status: "failed" });
    return undefined;
  }
}

export const LOCATION_FAILED_MESSAGE = "위치를 확인할 수 없어요";
