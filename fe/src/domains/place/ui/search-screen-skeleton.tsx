"use client";

import { Fab } from "@/shared/ui/button/fab";
import { BookmarkIcon } from "@/shared/ui/icon/icons/bookmark";
import { UserIcon } from "@/shared/ui/icon/icons/user";
import { StatusBarColor } from "@/shared/ui/layout/status-bar-color";

import { SearchBar } from "./search-bar";

const noop = () => {};

// 미리 렌더링한 검색 홈의 첫 HTML. SearchScreen은 ?view=saved를 useSearchParams로 읽어 브라우저에서야 그려지므로
// 그 전까지 같은 자리에 지도 바탕, 저장한 장소·내 정보 버튼, 검색창을 보인다. 앱이 뜨면 SearchScreen으로 바뀐다.
// 자리와 모양은 SearchScreen의 첫 화면(와이어프레임 Start)과 맞춘다
export function SearchScreenSkeleton() {
  return (
    <main className="relative h-viewport overflow-hidden">
      <StatusBarColor />
      <div aria-hidden className="absolute inset-0 bg-map-bg" />
      <div className="absolute top-safe-banner-4 right-4 flex flex-col gap-2">
        <Fab label="저장한 장소">
          <BookmarkIcon className="text-icon" />
        </Fab>
        <Fab label="내 정보">
          <UserIcon className="text-icon" />
        </Fab>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 pb-safe-4">
        <div className="px-4">
          <SearchBar onSearch={noop} onOpenRecent={noop} />
        </div>
      </div>
    </main>
  );
}
