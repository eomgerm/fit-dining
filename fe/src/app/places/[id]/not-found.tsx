import { PinOffIcon } from "@/shared/ui/icon/icons/pin-off";

import { NotFoundView } from "../../not-found-view";

// 장소 상세·리뷰 작성 주소의 id가 잘못됐거나 없는 장소다
export default function PlaceNotFound() {
  return (
    <NotFoundView
      icon={<PinOffIcon />}
      title="장소를 찾을 수 없어요"
      description="주소가 맞는지 확인해 주세요"
    />
  );
}
