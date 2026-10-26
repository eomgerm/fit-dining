"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { restore } from "@/domains/auth/api/auth-client";
import { parsePlaceId } from "@/domains/review/model/review";
import { SimpleReviewForm } from "@/domains/review/ui/simple-review-form";
import { Button } from "@/shared/ui/button/button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { PinOffIcon } from "@/shared/ui/icon/icons/pin-off";

import { withAccessToken } from "./with-access-token";

// 장소 상세 주소. 상세 탭은 화면 상태라 주소에 싣지 않는다(D-32)
function placeDetailHref(placeId: number) {
  return `/place?id=${placeId}`;
}

export function ReviewWriteScreen() {
  const router = useRouter();
  const placeId = parsePlaceId(useSearchParams().get("id"));
  const [signedIn, setSignedIn] = useState(false);

  // 리뷰는 로그인한 사용자만 쓴다. 쓰기 전에 세션을 확인하고, 없으면 로그인 화면으로 바꿔치기해
  // 로그인 화면의 "뒤로"가 이 화면이 아니라 장소 상세로 가게 한다. 로그인 뒤 이 화면으로 돌아오는 것은 아직 없다
  useEffect(() => {
    let active = true;
    restore().then(
      () => active && setSignedIn(true),
      () => active && router.replace("/login"),
    );
    return () => {
      active = false;
    };
  }, [router]);

  if (placeId === null) {
    return (
      <main className="flex flex-1 flex-col justify-center">
        <EmptyState
          icon={<PinOffIcon />}
          title="장소를 찾을 수 없어요"
          description="주소가 맞는지 확인해 주세요"
          action={
            <Button
              render={<Link href="/" />}
              nativeButton={false}
              variant="outline"
              size="md"
            >
              처음으로
            </Button>
          }
        />
      </main>
    );
  }

  // 등록 뒤와 닫기가 같다. 장소 상세에서 들어왔으면 뒤로 가서 보던 탭 그대로 돌아가고,
  // 주소로 바로 열었으면 장소 상세로 바꿔치기한다. 등록 뒤에 상세 주소로 바꿔치기하면
  // 방문 기록에 상세가 두 번 남아 상세의 "뒤로"를 두 번 눌러야 한다(D-32)
  const leave = () =>
    window.history.length > 1
      ? router.back()
      : router.replace(placeDetailHref(placeId));
  if (!signedIn) return null;
  return (
    <SimpleReviewForm
      placeId={placeId}
      withAccessToken={withAccessToken}
      onSuccess={leave}
      onClose={leave}
    />
  );
}
