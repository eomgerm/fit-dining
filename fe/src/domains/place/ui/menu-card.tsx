import type { Menu } from "../model/place-types";
import { PlacePhoto } from "./place-parts";

export function formatPrice(price: number) {
  return `${price.toLocaleString("ko-KR")}원`;
}

// 홈 탭 메뉴 미리보기의 가로 카드
export function MenuCard({ menu }: { menu: Menu }) {
  return (
    <div className="flex w-32 shrink-0 flex-col gap-1.5">
      <PlacePhoto
        src={menu.photoUrl}
        className="aspect-square w-full rounded-md"
      />
      <span className="truncate text-body-sm text-ink">{menu.name}</span>
      {menu.price !== undefined && (
        <span className="text-label-md text-ink">
          {formatPrice(menu.price)}
        </span>
      )}
    </div>
  );
}

// 메뉴 탭의 한 줄(와이어프레임 DetailMenu). 사진, 굵은 이름, 오른쪽 가격. 가격이 없으면 생략한다
export function MenuRow({ menu }: { menu: Menu }) {
  return (
    <div className="flex items-center gap-3.5 py-3">
      <PlacePhoto src={menu.photoUrl} className="size-16 shrink-0 rounded-md" />
      <span className="min-w-0 flex-1 text-title-sm text-ink">{menu.name}</span>
      {menu.price !== undefined && (
        <span className="shrink-0 text-body-md text-ink">
          {formatPrice(menu.price)}
        </span>
      )}
    </div>
  );
}
