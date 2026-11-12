// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/overlay/toast";

import type { WithSession } from "../api/queries";
import type { MeetupInfo } from "../model/meetup";
import { MeetupCreateForm } from "./meetup-create-form";
import { MeetupInfoCard } from "./meetup-info-card";

const api = vi.hoisted(() => ({
  createMeetup: vi.fn(),
  searchAreas: vi.fn(),
  checkArea: vi.fn(),
  fetchSnapshot: vi.fn(),
}));
vi.mock("../api/meetup-api", () => api);

const config = vi.hoisted(() => ({
  value: { env: "dev", naverMapClientId: "key" } as {
    env: string;
    naverMapClientId?: string;
  },
}));
vi.mock("@/shared/lib/runtime-config", () => ({
  loadRuntimeConfig: async () => config.value,
}));

const withSession: WithSession = (send) => send();
const NOON = new Date("2026-11-11T03:00:00Z");

// 지도에서 고르기와 지도 보기가 쓰는 만큼만 흉내 낸 네이버 지도 SDK. center로 사용자가 옮긴 지도를 흉내 낸다.
// broken은 인증에 실패한 SDK처럼 만들 때나 치울 때 던지게 한다
function stubMaps() {
  const broken = { create: false, teardown: false };
  const throwOnTeardown = (map: unknown) => {
    if (map === null && broken.teardown) throw new Error("인증 실패");
  };
  const center = { lat: 37.4979, lng: 127.0276 };
  const listeners: { target: unknown; name: string; listener: () => void }[] =
    [];
  const latLng = (lat: number, lng: number) => ({
    lat: () => lat,
    lng: () => lng,
  });
  const maps: { fitBounds: ReturnType<typeof vi.fn> }[] = [];
  const circles: {
    options: { radius: number };
    setRadius: ReturnType<typeof vi.fn>;
  }[] = [];
  const markers: { options: object }[] = [];
  const naver = {
    Map: class {
      constructor(
        _: unknown,
        readonly options: object,
      ) {
        if (broken.create) throw new Error("인증 실패");
        maps.push(this);
      }
      getCenter = () => latLng(center.lat, center.lng);
      fitBounds = vi.fn();
      panTo = vi.fn();
      destroy() {
        throwOnTeardown(null);
      }
    },
    LatLng: class {
      constructor(
        readonly latValue: number,
        readonly lngValue: number,
      ) {}
      lat = () => this.latValue;
      lng = () => this.lngValue;
    },
    Circle: class {
      constructor(readonly options: { radius: number }) {
        circles.push(this);
      }
      setRadius = vi.fn();
      setCenter = vi.fn();
      setMap = throwOnTeardown;
      getBounds = () => ({});
    },
    Marker: class {
      constructor(readonly options: object) {
        markers.push(this);
      }
      setMap = throwOnTeardown;
    },
    Point: class {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    },
    Event: {
      addListener(target: unknown, name: string, listener: () => void) {
        const entry = { target, name, listener };
        listeners.push(entry);
        return entry;
      },
      removeListener(entry: unknown) {
        listeners.splice(listeners.indexOf(entry as never), 1);
      },
    },
  };
  vi.stubGlobal("naver", { maps: naver });
  const fire = (name: string) =>
    act(() =>
      listeners
        .filter((entry) => entry.name === name)
        .forEach(({ listener }) => listener()),
    );
  return { center, maps, circles, markers, broken, fire };
}

function mountForm() {
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MeetupCreateForm
          withSession={withSession}
          now={() => NOON}
          onBack={vi.fn()}
          onCreated={onCreated}
          onUnauthorized={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onCreated;
}

beforeEach(() => {
  config.value = { env: "dev", naverMapClientId: "key" };
  api.searchAreas.mockResolvedValue({ items: [] });
  api.checkArea.mockResolvedValue({ placeCount: 2, name: "연동 근처" });
  api.createMeetup.mockResolvedValue({
    code: "abcdefghijklmnopqrstuv",
    questions: { mood: true, food: true, spicy: true, price: false },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("지도에서 고르기", () => {
  it("지도를 불러오지 못하면 지도로 고르기를 숨긴다", async () => {
    config.value = { env: "dev" };
    stubMaps();
    mountForm();
    expect(
      await screen.findByText("역이나 동 이름을 넣어 주세요"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "지도에서 고르기" }),
    ).toBeNull();
  });

  it("SDK가 지도를 만들 때 던지면 고르기를 닫고, 치울 때 던져도 화면이 그대로다", async () => {
    const stub = stubMaps();
    stub.broken.create = true;
    mountForm();
    fireEvent.click(
      await screen.findByRole("button", { name: "지도에서 고르기" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    stub.broken.create = false;
    stub.broken.teardown = true;
    fireEvent.click(screen.getByRole("button", { name: "지도에서 고르기" }));
    const dialog = await screen.findByRole("dialog", {
      name: "지도에서 고르기",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "뒤로" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "지도에서 고르기" }),
    ).toBeTruthy();
  });

  it("지도를 옮기고 반경을 바꾸면 그 지점의 장소 수를 보이고, 정하면 지역 칸과 만들기에 그 지점이 실린다", async () => {
    const stub = stubMaps();
    const onCreated = mountForm();
    fireEvent.click(
      await screen.findByRole("button", { name: "지도에서 고르기" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "지도에서 고르기",
    });
    await waitFor(() =>
      expect(api.checkArea).toHaveBeenCalledWith(
        { lat: 37.4979, lng: 127.0276, radiusM: 500 },
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(dialog.textContent).toContain("반경 안에 장소가 2곳 있어요."),
    );
    expect(
      (screen.getByRole("textbox", { name: "위치 이름" }) as HTMLInputElement)
        .value,
    ).toBe("연동 근처");

    stub.center.lat = 33.45;
    stub.center.lng = 126.57;
    await stub.fire("idle");
    fireEvent.click(screen.getByRole("button", { name: "1km" }));
    await waitFor(() =>
      expect(api.checkArea).toHaveBeenLastCalledWith(
        { lat: 33.45, lng: 126.57, radiusM: 1000 },
        expect.anything(),
      ),
    );
    expect(stub.circles[0].setRadius).toHaveBeenLastCalledWith(1000);
    expect(stub.maps[0].fitBounds).toHaveBeenCalledTimes(2);

    const confirm = screen.getByRole("button", { name: "이 위치로 정하기" });
    await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
    fireEvent.click(confirm);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (screen.getByRole("combobox", { name: /지역/ }) as HTMLInputElement)
        .value,
    ).toBe("연동 근처 · 반경 1km");

    fireEvent.click(screen.getByRole("button", { name: /내 취향 남기기/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(api.createMeetup.mock.calls[0][0].area).toEqual({
      kind: "POINT",
      lat: 33.45,
      lng: 126.57,
      radiusM: 1000,
      name: "연동 근처",
    });
  });

  it("반경 안에 장소가 없으면 알리고 정할 수 없다", async () => {
    api.checkArea.mockResolvedValue({ placeCount: 0 });
    stubMaps();
    mountForm();
    fireEvent.click(
      await screen.findByRole("button", { name: "지도에서 고르기" }),
    );
    expect(
      await screen.findByText(
        "이 근처에는 아직 장소가 없어요. 지도를 옮기거나 반경을 넓혀 보세요.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "이 위치로 정하기" }),
    ).toHaveProperty("disabled", true);
  });
});

const POINT_INFO: MeetupInfo = {
  area: {
    kind: "POINT",
    name: "연동 근처",
    lat: 33.45,
    lng: 126.57,
    radiusM: 1000,
  },
  category: "RESTAURANT",
  expiresOn: "2026-11-21",
};

describe("모임 정보의 지점 줄과 지도 보기", () => {
  it("지점 모임은 지도 없이 위치 이름과 반경 줄을 보이고, 지도 보기를 누르면 핀과 반경 원을 그린다", async () => {
    const stub = stubMaps();
    render(<MeetupInfoCard info={POINT_INFO} />);
    expect(screen.getByText("연동 근처")).toBeTruthy();
    expect(screen.getByText("반경 1km")).toBeTruthy();
    expect(screen.queryByText("연동 근처 · 반경 1km")).toBeNull();
    expect(stub.maps).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "지도 보기" }));
    expect(
      await screen.findByRole("dialog", { name: "모임 위치" }),
    ).toBeTruthy();
    await waitFor(() => expect(stub.circles).toHaveLength(1));
    expect(stub.circles[0].options.radius).toBe(1000);
    expect(stub.markers).toHaveLength(1);
    expect(stub.maps[0].fitBounds).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("지도를 불러오지 못하면 지도 보기에 안내만 보인다", async () => {
    config.value = { env: "dev" };
    const stub = stubMaps();
    render(<MeetupInfoCard info={POINT_INFO} />);
    fireEvent.click(screen.getByRole("button", { name: "지도 보기" }));
    expect(
      await screen.findByText(
        "지도를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      ),
    ).toBeTruthy();
    expect(stub.maps).toHaveLength(0);
  });

  it("SDK가 지도를 만들 때 던지면 안내를 보이고, 치울 때 던져도 화면이 그대로다", async () => {
    const stub = stubMaps();
    stub.broken.create = true;
    render(<MeetupInfoCard info={POINT_INFO} />);
    fireEvent.click(screen.getByRole("button", { name: "지도 보기" }));
    expect(
      await screen.findByText(
        "지도를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    stub.broken.create = false;
    stub.broken.teardown = true;
    fireEvent.click(screen.getByRole("button", { name: "지도 보기" }));
    await waitFor(() => expect(stub.markers).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "지도 보기" })).toBeTruthy();
  });
});
