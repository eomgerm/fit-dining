import type { LatLng } from "../model/place-types";
import { searchStore } from "../model/search-store";

const LOCATION_TIMEOUT_MS = 10_000;
// 이 안에 얻은 위치는 브라우저가 새로 찾지 않고 돌려준다(D-101)
const LOCATION_MAX_AGE_MS = 300_000;

// 앱을 열 때의 위치 결정 결과(spec 40번). unavailable은 권한이 아직 정해지지 않았거나 알 수 없어 묻지 않은 것이다
export type InitialLocation =
  | { status: "located"; here: LatLng }
  | { status: "denied" }
  | { status: "failed" }
  | { status: "unavailable" };

// 페이지 세션 하나의 위치 조회 상태. 화면이 다시 마운트돼도 같은 것을 쓴다
type Session = {
  initial?: Promise<InitialLocation>;
  // 진행 중인 getCurrentPosition. 처음 조회와 "내 위치"가 함께 기다린다
  inFlight?: Promise<LatLng>;
  // "내 위치"가 처음 조회를 대신했는지. 그러면 처음 조회는 알리지 않는다(버튼이 알린다)
  buttonTookOver: boolean;
};

const sessions = new WeakMap<object, Session>();

function session() {
  const key = searchStore.pageSession;
  let current = sessions.get(key);
  if (!current) {
    current = { buttonTookOver: false };
    sessions.set(key, current);
  }
  return current;
}

function currentPosition() {
  const current = session();
  current.inFlight ??= new Promise<LatLng>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      reject,
      { timeout: LOCATION_TIMEOUT_MS, maximumAge: LOCATION_MAX_AGE_MS },
    );
  }).finally(() => {
    current.inFlight = undefined;
  });
  return current.inFlight;
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

// "내 위치" 버튼. 누른 순간부터 남은 처음 이동을 대신하고, 처음 조회가 진행 중이면 같은 조회를 기다린다(spec 62번)
export function locateFromButton() {
  session().buttonTookOver = true;
  searchStore.finishInitialView();
  return locateDevice();
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

// 처음 조회의 결과를 store에 옮긴다(spec 62번). 처음 이동이 이미 끝났으면(버튼, 사용자가 지도를 움직임)
// 이미 정해진 위치를 덮지 않고, 버튼이 대신했으면 알리지 않는다
function apply(result: InitialLocation) {
  const { location, initialView } = searchStore.getSnapshot();
  if (result.status === "unavailable") {
    searchStore.finishInitialView();
    return;
  }
  if (result.status === "located") {
    if (initialView === "pending" || location.status !== "ok") {
      searchStore.setLocation({ status: "ok", here: result.here });
    }
    return;
  }
  if (location.status === "ok") return;
  searchStore.setLocation({ status: "failed" });
  if (!session().buttonTookOver) searchStore.noticeLocation(result.status);
  searchStore.finishInitialView();
}

async function decide(): Promise<InitialLocation> {
  const permission = await geolocationPermission();
  if (permission === "denied") return { status: "denied" };
  if (permission !== "granted") return { status: "unavailable" };
  const { initialView, location } = searchStore.getSnapshot();
  const { inFlight } = session();
  // 처음 이동이 이미 끝났으면 새로 조회하지 않는다. 진행 중인 버튼 조회가 있으면 그 결과를 기다린다
  if (initialView === "done" && !inFlight) {
    return location.status === "ok"
      ? { status: "located", here: location.here }
      : { status: "unavailable" };
  }
  try {
    return { status: "located", here: await currentPosition() };
  } catch {
    return { status: "failed" };
  }
}

// 앱을 열 때의 위치 결정. 페이지 세션에 한 번만 하고 다시 들어온 화면은 같은 결과를 기다린다.
// 권한이 이미 허용이면 묻지 않고 위치를 받고, 그 밖에는 요청하지 않는다(spec 40번)
export function initialLocation() {
  const current = session();
  current.initial ??= decide().then((result) => {
    apply(result);
    return result;
  });
  return current.initial;
}

export const LOCATION_FAILED_MESSAGE = "위치를 확인할 수 없어요";

// 4-E01. 두 줄로 보인다
export const LOCATION_DENIED_MESSAGE =
  "위치 권한이 꺼져 있어요.\n브라우저 설정에서 허용해 주세요.";
