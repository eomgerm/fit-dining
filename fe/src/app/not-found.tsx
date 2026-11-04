import { WarningIcon } from "@/shared/ui/icon/icons/warning";

import { NotFoundView } from "./not-found-view";

// 맞는 경로가 없는 주소와, 더 가까운 not-found가 없는 notFound()
export default function NotFound() {
  return (
    <NotFoundView
      icon={<WarningIcon />}
      title="페이지를 찾을 수 없어요"
      description="주소가 맞는지 확인해 주세요"
    />
  );
}
