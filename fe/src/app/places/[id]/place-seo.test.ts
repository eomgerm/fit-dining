import { describe, expect, it } from "vitest";

import type { Hours, PlaceDetail } from "@/domains/place/model/place-types";

import { placeJsonLd, placeMetadata } from "./place-seo";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

const unknownHours: Hours[] = DAYS.map((dayOfWeek) => ({
  dayOfWeek,
  breaks: [],
  lastOrders: [],
  closed: false,
}));

function detail(overrides: Partial<PlaceDetail> = {}): PlaceDetail {
  return {
    place: {
      id: 7,
      name: "모너트 MONERT",
      categoryGroup: "RESTAURANT",
      station: "SEOLLEUNG",
      lat: 37.499,
      lng: 127.052,
    },
    address: "서울 강남구 테헤란로 1",
    tags: [],
    photos: [],
    openStatus: "UNKNOWN",
    hours: unknownHours,
    menus: [],
    facilities: [],
    subways: [],
    noKidsZone: false,
    seats: [],
    paymentMethods: [],
    broadcasts: [],
    extraLinks: [],
    ...overrides,
  };
}

const parse = (place: PlaceDetail) => JSON.parse(placeJsonLd(place));

describe("placeMetadata", () => {
  it("제목은 장소명이고 canonical은 from 없는 상세 주소다", () => {
    const metadata = placeMetadata(detail());

    expect(metadata.title).toBe("모너트 MONERT");
    expect(metadata.alternates?.canonical).toBe("/places/7");
    expect(metadata.openGraph).toMatchObject({
      title: "모너트 MONERT",
      url: "/places/7",
      siteName: "핏다이닝",
    });
  });

  it("장소 소개가 있으면 설명으로 쓴다", () => {
    const metadata = placeMetadata(detail({ description: "직접 볶은 원두" }));

    expect(metadata.description).toBe("직접 볶은 원두");
    expect(metadata.openGraph?.description).toBe("직접 볶은 원두");
  });

  it("사진이 있으면 첫 사진을 공유 이미지로 쓴다", () => {
    const metadata = placeMetadata(
      detail({ photos: ["/fit-prod-photos/a.jpg", "/fit-prod-photos/b.jpg"] }),
    );

    expect(metadata.openGraph?.images).toEqual(["/fit-prod-photos/a.jpg"]);
  });

  // 비워 두면 루트 opengraph-image.png(사이트 공유 이미지)가 붙는다
  it("사진이 없으면 공유 이미지를 정하지 않는다", () => {
    expect(placeMetadata(detail()).openGraph).not.toHaveProperty("images");
  });

  it("장소 소개가 없으면 업종과 주소로 설명을 만든다", () => {
    expect(placeMetadata(detail()).description).toBe(
      "식당 · 서울 강남구 테헤란로 1",
    );
    expect(placeMetadata(detail({ address: "" })).description).toBe("식당");
  });
});

describe("placeJsonLd", () => {
  it("장소명·주소·좌표·전화·상세 주소를 Restaurant로 담는다", () => {
    expect(parse(detail({ phone: "02-000-0000" }))).toEqual({
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: "모너트 MONERT",
      url: "https://fitdining.co.kr/places/7",
      address: {
        "@type": "PostalAddress",
        streetAddress: "서울 강남구 테헤란로 1",
        addressCountry: "KR",
      },
      geo: { "@type": "GeoCoordinates", latitude: 37.499, longitude: 127.052 },
      telephone: "02-000-0000",
    });
  });

  it("카페와 술집은 schema.org의 해당 타입이다", () => {
    const place = detail().place;
    expect(
      parse(detail({ place: { ...place, categoryGroup: "CAFE" } }))["@type"],
    ).toBe("CafeOrCoffeeShop");
    expect(
      parse(detail({ place: { ...place, categoryGroup: "BAR" } }))["@type"],
    ).toBe("BarOrPub");
  });

  it("사진은 사이트 기준 절대 주소로 담는다", () => {
    const json = parse(
      detail({
        photos: [
          "https://ldb-phinf.pstatic.net/a.jpg",
          "/fit-prod-photos/b.jpg",
        ],
      }),
    );

    expect(json.image).toEqual([
      "https://ldb-phinf.pstatic.net/a.jpg",
      "https://fitdining.co.kr/fit-prod-photos/b.jpg",
    ]);
  });

  it("주소·사진·전화·영업시간이 없으면 그 항목을 뺀다", () => {
    const json = parse(detail({ address: "" }));

    expect(json).not.toHaveProperty("address");
    expect(json).not.toHaveProperty("image");
    expect(json).not.toHaveProperty("telephone");
    expect(json).not.toHaveProperty("openingHoursSpecification");
  });

  it("영업시간은 휴무일을 빼고 브레이크타임으로 나눈다", () => {
    const hours: Hours[] = [
      {
        dayOfWeek: "MON",
        open: "11:00",
        close: "22:00",
        breaks: [{ start: "15:00", end: "17:00" }],
        lastOrders: [],
        closed: false,
      },
      { dayOfWeek: "TUE", breaks: [], lastOrders: [], closed: true },
      {
        dayOfWeek: "SAT",
        open: "18:00",
        close: "02:00",
        breaks: [],
        lastOrders: [],
        closed: false,
      },
    ];

    expect(parse(detail({ hours })).openingHoursSpecification).toEqual([
      spec("Monday", "11:00", "15:00"),
      spec("Monday", "17:00", "22:00"),
      spec("Saturday", "18:00", "02:00"),
    ]);
  });

  // 화면은 00:00 – 00:00을 24시간 영업으로 읽는다. Google은 같은 00:00을 하루 휴무로 읽어 23:59로 닫는다
  it("24시간 영업은 00:00에 열어 23:59에 닫는다", () => {
    const hours: Hours[] = [
      {
        dayOfWeek: "SUN",
        open: "00:00",
        close: "00:00",
        breaks: [],
        lastOrders: [],
        closed: false,
      },
      {
        dayOfWeek: "FRI",
        open: "11:00",
        close: "00:00",
        breaks: [],
        lastOrders: [],
        closed: false,
      },
    ];

    expect(parse(detail({ hours })).openingHoursSpecification).toEqual([
      spec("Sunday", "00:00", "23:59"),
      spec("Friday", "11:00", "00:00"),
    ]);
  });

  it("장소명에 태그가 있어도 script를 닫지 못한다", () => {
    const place = detail().place;
    const raw = placeJsonLd(
      detail({ place: { ...place, name: "</script><script>alert(1)" } }),
    );

    expect(raw).not.toContain("<");
    expect(JSON.parse(raw).name).toBe("</script><script>alert(1)");
  });
});

function spec(day: string, opens: string, closes: string) {
  return {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: `https://schema.org/${day}`,
    opens,
    closes,
  };
}
