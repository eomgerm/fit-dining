// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render as mount,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/shared/ui/overlay/toast";

import { ReviewPhotoField } from "./review-photo-field";
import type { PhotoTile, ReviewPhotos } from "./use-review-photos";

const noop = () => {};

function render(tiles: PhotoTile[], addLabel?: string) {
  const photos: ReviewPhotos = {
    tiles,
    add: () => 0,
    remove: noop,
    retry: noop,
    photoIds: [],
    busy: tiles.some(
      (tile) => tile.status === "processing" || tile.status === "uploading",
    ),
    failed: tiles.some((tile) => tile.status === "failed"),
    max: 5,
  };
  return renderToStaticMarkup(
    <ToastProvider>
      <ReviewPhotoField photos={photos} hint="최대 5장" addLabel={addLabel} />
    </ToastProvider>,
  );
}

describe("ReviewPhotoField", () => {
  it("사진이 없으면 장수를 붙인 추가 버튼과 여러 장을 고르는 사진 입력을 둔다", () => {
    const html = render([]);

    expect(html).toContain('aria-label="사진 추가, 0/5장"');
    expect(html).toContain(">0/5<");
    expect(html).toMatch(/<input type="file" accept="image\/\*" multiple=""/);
    expect(html).toContain("최대 5장");
  });

  it("작성 화면은 추가 버튼에 '추가'를 쓴다(7-04)", () => {
    expect(render([], "추가")).toContain(">추가<");
  });

  it("칸마다 빼기 버튼이 있고, 올리지 못한 칸에만 다시 올리기가 있다", () => {
    const html = render([
      { key: "a", status: "uploaded", photoId: "a", previewUrl: "blob:a" },
      { key: "b", status: "failed", previewUrl: "blob:b" },
      { key: "c", status: "processing" },
    ]);

    expect(html).toContain('aria-label="사진 1 빼기"');
    expect(html).toContain('aria-label="사진 3 빼기"');
    expect(html.match(/다시 올리기/g)).toEqual(["다시 올리기"]);
    expect(html).toContain('aria-label="사진 2 다시 올리기"');
    expect(html).toContain('alt="사진 1"');
    expect(html).toContain("사진을 올리고 있어요");
  });

  it("올리지 못한 사진이 있으면 화면 낭독기에 알린다", () => {
    const html = render([{ key: "b", status: "failed", previewUrl: "data:b" }]);

    expect(html).toMatch(
      /role="status"[^>]*>올리지 못한 사진이 있어요. 다시 올리거나 빼 주세요/,
    );
  });

  it("5장이면 추가 버튼을 두지 않는다", () => {
    const tiles: PhotoTile[] = Array.from({ length: 5 }, (_, i) => ({
      key: String(i),
      status: "saved",
      photoId: String(i),
      previewUrl: `/p${i}.thumb.jpg`,
    }));

    expect(render(tiles)).not.toContain("사진 추가");
  });
});

// 빼기를 누르면 칸이 실제로 빠지는 사진 칸
function Harness({ initial }: { initial: PhotoTile[] }) {
  const [tiles, setTiles] = useState(initial);
  const photos: ReviewPhotos = {
    tiles,
    add: () => 0,
    remove: (key) =>
      setTiles((current) => current.filter((t) => t.key !== key)),
    retry: noop,
    photoIds: [],
    busy: false,
    failed: false,
    max: 5,
  };
  return (
    <ToastProvider>
      <ReviewPhotoField photos={photos} />
    </ToastProvider>
  );
}

const saved = (key: string): PhotoTile => ({
  key,
  status: "saved",
  photoId: key,
  previewUrl: `/${key}.thumb.jpg`,
});

describe("ReviewPhotoField 포커스", () => {
  afterEach(() => cleanup());

  it("칸을 빼면 그 자리의 다음 칸 빼기 버튼으로 포커스를 옮긴다", () => {
    mount(<Harness initial={[saved("a"), saved("b")]} />);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "사진 1 빼기" }));
    });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "사진 1 빼기" }),
    );
  });

  it("마지막 칸을 빼면 추가 버튼으로 포커스를 옮긴다", () => {
    mount(<Harness initial={[saved("a")]} />);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "사진 1 빼기" }));
    });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "사진 추가, 0/5장" }),
    );
  });
});
