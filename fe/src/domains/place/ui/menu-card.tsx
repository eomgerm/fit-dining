import { Tag } from "@/shared/ui/display/tag";

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

// 메뉴 탭의 한 줄(와이어프레임 DetailMenu). 64px 사진, 굵은 이름과 옆의 "대표"·라벨 칩,
// 이름 아래 흐린 설명(두 줄까지), 오른쪽 가격 원문. 가격 원문이 없으면 생략한다
export function MenuRow({ menu }: { menu: Menu }) {
  return (
    <div className="flex items-center gap-3.5 py-3">
      <PlacePhoto src={menu.photoUrl} className="size-16 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <span data-menu-name className="mr-0.5 text-title-sm text-ink">
            {menu.name}
          </span>
          {menu.representative && <Tag variant="match">대표</Tag>}
          {menu.labels.map((label) => (
            <Tag key={label}>{label}</Tag>
          ))}
        </div>
        {menu.description && (
          <p className="line-clamp-2 text-body-sm text-ink-muted">
            {menu.description}
          </p>
        )}
      </div>
      {menu.priceText && (
        <span className="shrink-0 text-body-md text-ink">{menu.priceText}</span>
      )}
    </div>
  );
}
