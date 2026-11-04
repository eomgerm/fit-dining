import { WarningIcon } from "@/shared/ui/icon/icons/warning";

import { NotFoundView } from "../../../../not-found-view";

// 리뷰 수정 주소의 장소 id나 리뷰 id가 잘못됐다
export default function ReviewNotFound() {
  return (
    <NotFoundView
      icon={<WarningIcon />}
      title="리뷰를 찾을 수 없어요"
      description="주소가 맞는지 확인해 주세요"
    />
  );
}
