import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSearchStore, type SearchStore } from "../model/search-store";
import {
  initialLocation,
  locateDevice,
  locateFromButton,
  stopInitialMoveByUser,
} from "./locate-device";

// 테스트마다 새 store(새 페이지 세션)를 쓴다
const stores = vi.hoisted(() => ({
  current: undefined as unknown as SearchStore,
}));
vi.mock("../model/search-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model/search-store")>();
  return {
    ...actual,
    searchStore: new Proxy({} as SearchStore, {
      get: (_, key: keyof SearchStore) => stores.current[key],
    }),
  };
});

const HERE = { lat: 37.5, lng: 127.03 };

// 일부러 늦게 끝내는 가짜 위치 조회. 부른 순서대로 succeed나 fail로 끝낸다
function stubDevice(permission?: PermissionState | "throws") {
  const pending: {
    success: PositionCallback;
    error: PositionErrorCallback;
    options?: PositionOptions;
  }[] = [];
  let resolvePermission: (() => void) | undefined;
  const permissionReady = new Promise<void>((resolve) => {
    resolvePermission = resolve;
  });
  const getCurrentPosition = vi.fn(
    (
      success: PositionCallback,
      error: PositionErrorCallback,
      options?: PositionOptions,
    ) => {
      pending.push({ success, error, options });
    },
  );
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition },
    ...(permission && {
      permissions: {
        query: async () => {
          await permissionReady;
          if (permission === "throws") throw new Error("unsupported");
          return { state: permission };
        },
      },
    }),
  });
  return {
    getCurrentPosition,
    grantPermission: () => resolvePermission?.(),
    succeed: (index = 0) =>
      pending[index].success({
        coords: { latitude: HERE.lat, longitude: HERE.lng },
      } as GeolocationPosition),
    fail: (index = 0, code = 1) =>
      pending[index].error({ code } as GeolocationPositionError),
    options: (index = 0) => pending[index].options,
  };
}

const snapshot = () => stores.current.getSnapshot();
// 기다리는 Promise들이 차례로 끝나게 한다
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  stores.current = createSearchStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initialLocation", () => {
  it("권한이 허용이면 묻지 않고 위치를 받아 store에 두고, 처음 이동은 아직 남는다", async () => {
    const device = stubDevice("granted");
    const result = initialLocation();
    device.grantPermission();
    await settle();
    device.succeed();

    expect(await result).toEqual({ status: "located", here: HERE });
    expect(snapshot().location).toEqual({ status: "ok", here: HERE });
    expect(snapshot().initialView).toBe("pending");
    expect(snapshot().locationNotice).toBeUndefined();
    expect(device.options()).toEqual({ timeout: 10_000, maximumAge: 300_000 });
  });

  it.each([
    ["거부", 1],
    ["시간 초과", 3],
  ])(
    "권한은 허용인데 위치를 못 얻으면(%s) failed로 두고 알림을 남기며 처음 이동을 끝낸다",
    async (_, code) => {
      const device = stubDevice("granted");
      const result = initialLocation();
      device.grantPermission();
      await settle();
      device.fail(0, code);

      expect(await result).toEqual({ status: "failed" });
      expect(snapshot().location).toEqual({ status: "failed" });
      expect(snapshot().locationNotice).toBe("failed");
      expect(snapshot().initialView).toBe("done");
    },
  );

  it("권한이 꺼져 있으면 위치를 묻지 않고 failed로 두며 권한 알림을 남긴다", async () => {
    const device = stubDevice("denied");
    const result = initialLocation();
    device.grantPermission();

    expect(await result).toEqual({ status: "denied" });
    expect(device.getCurrentPosition).not.toHaveBeenCalled();
    expect(snapshot().location).toEqual({ status: "failed" });
    expect(snapshot().locationNotice).toBe("denied");
    expect(snapshot().initialView).toBe("done");
  });

  it.each([
    ["권한이 아직 정해지지 않았으면", "prompt" as const],
    ["권한 조회가 실패하면", "throws" as const],
    ["Permissions API가 없으면", undefined],
  ])(
    "%s 위치를 묻지 않고 알림 없이 처음 이동을 끝낸다",
    async (_, permission) => {
      const device = stubDevice(permission);
      const result = initialLocation();
      device.grantPermission();

      expect(await result).toEqual({ status: "unavailable" });
      expect(device.getCurrentPosition).not.toHaveBeenCalled();
      expect(snapshot().location).toEqual({ status: "idle" });
      expect(snapshot().locationNotice).toBeUndefined();
      expect(snapshot().initialView).toBe("done");
    },
  );

  it("페이지 세션에 한 번만 조회하고, 다시 부르면 같은 결과를 기다린다", async () => {
    const device = stubDevice("granted");
    const first = initialLocation();
    const second = initialLocation();
    device.grantPermission();
    await settle();
    device.succeed();

    expect(await second).toEqual(await first);
    expect(device.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("새 페이지 세션(새 store)에서는 다시 조회한다", async () => {
    const device = stubDevice("granted");
    device.grantPermission();
    const first = initialLocation();
    await settle();
    device.succeed(0);
    await first;

    stores.current = createSearchStore();
    const second = initialLocation();
    await settle();
    device.succeed(1);

    expect(await second).toEqual({ status: "located", here: HERE });
    expect(device.getCurrentPosition).toHaveBeenCalledTimes(2);
  });
});

describe('"내 위치" 버튼과 처음 조회 (AC-49, AC-50)', () => {
  it("권한 확인 중에 버튼을 누르면 위치 조회는 버튼의 1회뿐이고 남은 처음 이동은 버튼이 대신한다", async () => {
    const device = stubDevice("granted");
    const initial = initialLocation();
    const button = locateFromButton();
    // 누르는 순간 끝나지 않고 버튼이 처음 이동을 가진다(spec 70번)
    expect(snapshot()).toMatchObject({
      initialView: "applying",
      initialOwnedByButton: true,
    });

    device.grantPermission();
    await settle();
    device.succeed();

    expect(await button).toEqual(HERE);
    await initial;
    expect(device.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(snapshot().location).toEqual({ status: "ok", here: HERE });
  });

  it("처음 조회가 진행 중일 때 버튼을 누르면 같은 조회를 기다린다", async () => {
    const device = stubDevice("granted");
    const initial = initialLocation();
    device.grantPermission();
    await settle();
    const button = locateFromButton();
    device.succeed();

    expect(await button).toEqual(HERE);
    expect(await initial).toEqual({ status: "located", here: HERE });
    expect(device.getCurrentPosition).toHaveBeenCalledTimes(1);
    // 처음 조회의 결과로는 끝나지 않고 버튼의 이동이 끝낼 때까지 버튼이 가진다(spec 70번)
    expect(snapshot().initialView).toBe("applying");
  });

  it("권한이 정해지지 않은 채 확인 중에 버튼을 누르면 처음 조회가 unavailable로 끝나도 처음 이동은 끝나지 않는다(AC-64)", async () => {
    const device = stubDevice("prompt");
    const initial = initialLocation();
    locateFromButton();
    device.grantPermission();

    expect(await initial).toEqual({ status: "unavailable" });
    expect(snapshot().initialView).toBe("applying");
  });

  it("버튼이 대신한 뒤 같은 조회가 실패하면 처음 조회의 알림은 남기지 않는다(버튼이 알린다)", async () => {
    const device = stubDevice("granted");
    const initial = initialLocation();
    device.grantPermission();
    await settle();
    const button = locateFromButton();
    device.fail();

    expect(await button).toBeUndefined();
    await initial;
    expect(snapshot().location).toEqual({ status: "failed" });
    expect(snapshot().locationNotice).toBeUndefined();
  });

  it("버튼이 먼저 위치를 얻어 처음 이동이 끝난 뒤 시작한 처음 조회는 새로 조회하지 않고 그 위치를 덮지 않는다", async () => {
    const device = stubDevice("granted");
    device.grantPermission();
    // 버튼이 먼저 위치를 얻는다
    const button = locateFromButton();
    await settle();
    device.succeed(0);
    await button;

    const initial = initialLocation();
    await settle();

    expect(await initial).toEqual({ status: "located", here: HERE });
    expect(device.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(snapshot().location).toEqual({ status: "ok", here: HERE });
  });

  it("처음 이동이 끝난 뒤(사용자가 지도를 움직임) 처음 조회가 성공하면 위치만 기록하고 처음 이동은 다시 열리지 않는다", async () => {
    const device = stubDevice("granted");
    const initial = initialLocation();
    device.grantPermission();
    await settle();
    stopInitialMoveByUser();
    expect(snapshot().initialEndedBy).toBe("user");
    device.succeed();

    await initial;
    expect(snapshot().location).toEqual({ status: "ok", here: HERE });
    expect(snapshot().initialView).toBe("done");
  });

  it("사용자가 지도를 움직여 처음 이동이 끝난 뒤 권한 확인이 끝나면 새로 위치를 조회하지 않는다", async () => {
    const device = stubDevice("granted");
    const initial = initialLocation();
    stopInitialMoveByUser();
    expect(snapshot().initialView).toBe("done");
    device.grantPermission();
    await initial;

    expect(device.getCurrentPosition).not.toHaveBeenCalled();
    expect(snapshot().location).toEqual({ status: "idle" });
  });

  it("지도가 실패해 처음 이동이 끝난 뒤 권한 확인이 끝나면 위치는 받아 둔다(지도는 옮기지 않는다)", async () => {
    const device = stubDevice("granted");
    const initial = initialLocation();
    // 지도 키가 없거나 인증이 실패해 PlaceMap이 처음 이동을 끝낸다
    stores.current.finishInitialView();
    device.grantPermission();
    await settle();
    device.succeed();

    expect(await initial).toEqual({ status: "located", here: HERE });
    expect(device.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(snapshot().location).toEqual({ status: "ok", here: HERE });
    expect(snapshot().initialView).toBe("done");
  });

  it("이미 위치가 정해진 뒤 늦게 끝난 처음 조회가 실패여도 그 위치를 failed로 덮지 않고 알리지 않는다", async () => {
    const device = stubDevice("granted");
    const initial = initialLocation();
    device.grantPermission();
    await settle();
    // 처음 조회가 진행 중일 때 다른 경로(위치 허용 화면 등)가 위치를 먼저 정한다
    stores.current.setLocation({ status: "ok", here: HERE });
    stores.current.finishInitialView();
    device.fail();

    expect(await initial).toEqual({ status: "failed" });
    expect(snapshot().location).toEqual({ status: "ok", here: HERE });
    expect(snapshot().locationNotice).toBeUndefined();
  });
});

describe("locateDevice", () => {
  it("진행 중인 조회가 있으면 새로 부르지 않고 같은 결과를 기다린다", async () => {
    const device = stubDevice();
    const first = locateDevice();
    const second = locateDevice();
    device.succeed();

    expect(await first).toEqual(HERE);
    expect(await second).toEqual(HERE);
    expect(device.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(device.options()).toEqual({ timeout: 10_000, maximumAge: 300_000 });
  });

  it("10초 안에 위치가 오지 않으면(브라우저 시간 초과) failed가 된다", async () => {
    vi.useFakeTimers();
    try {
      // 브라우저처럼 옵션의 timeout이 지나면 시간 초과(code 3)로 끝낸다
      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: (
            _: PositionCallback,
            error: PositionErrorCallback,
            options: PositionOptions,
          ) =>
            setTimeout(
              () => error({ code: 3 } as GeolocationPositionError),
              options.timeout,
            ),
        },
      });
      const result = locateDevice();

      await vi.advanceTimersByTimeAsync(9_999);
      expect(snapshot().location).toEqual({ status: "pending" });

      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBeUndefined();
      expect(snapshot().location).toEqual({ status: "failed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("조회가 끝나면 다음 요청은 새로 조회한다", async () => {
    const device = stubDevice();
    const first = locateDevice();
    device.fail();
    expect(await first).toBeUndefined();
    expect(snapshot().location).toEqual({ status: "failed" });

    const second = locateDevice();
    device.succeed(1);
    expect(await second).toEqual(HERE);
    expect(device.getCurrentPosition).toHaveBeenCalledTimes(2);
  });
});
