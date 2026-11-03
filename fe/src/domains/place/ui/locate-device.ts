import type { LatLng } from "../model/place-types";
import { searchStore } from "../model/search-store";

const LOCATION_TIMEOUT_MS = 10_000;
// 이 안에 얻은 위치는 브라우저가 새로 찾지 않고 돌려준다(D-101)
const LOCATION_MAX_AGE_MS = 30_000;

function currentPosition() {
  return new Promise<LatLng>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      reject,
      { timeout: LOCATION_TIMEOUT_MS, maximumAge: LOCATION_MAX_AGE_MS },
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

async function geolocationPermission() {
  try {
    const { state } = await navigator.permissions.query({
      name: "geolocation",
    });
    return state;
  } catch {
    return undefined;
  }
}

export type OpenLocationResult = "located" | "failed" | "denied" | "skipped";

// 화면을 열 때 한 번. 권한이 이미 허용이면 묻지 않고 위치를 받고, 그 밖에는 요청하지 않는다.
// 페이지 세션에 한 번만 확인해 상세에서 돌아와도 다시 알리지 않는다
export async function locateIfGranted(): Promise<OpenLocationResult> {
  const { openLocationChecked, location } = searchStore.getSnapshot();
  if (openLocationChecked) return "skipped";
  searchStore.markOpenLocationChecked();
  if (location.status !== "idle") return "skipped";

  const permission = await geolocationPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "skipped";
  // 권한을 확인하는 사이 "내 위치" 버튼으로 이미 시도했으면 다시 받지 않는다
  if (searchStore.getSnapshot().location.status !== "idle") return "skipped";
  return (await locateDevice()) ? "located" : "failed";
}

export const LOCATION_FAILED_MESSAGE = "위치를 확인할 수 없어요";

// 4-E01. 두 줄로 보인다
export const LOCATION_DENIED_MESSAGE =
  "위치 권한이 꺼져 있어요.\n브라우저 설정에서 허용해 주세요.";
