"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  isNotFound,
  useMeetupSnapshot,
  useUpdateTaste,
} from "@/domains/meetup/api/queries";
import { formFromTaste, toTaste } from "@/domains/meetup/model/join-form";
import { meetupHref, myProfile } from "@/domains/meetup/model/meetup";
import { JoinFormView } from "@/domains/meetup/ui/join-form";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";
import { useToast } from "@/shared/ui/overlay/toast";
import { useLeave } from "@/shared/lib/use-leave";

import { MeetupLoadingScreen } from "../meetup-loading-screen";

// 내 취향 수정(/m/{code}/taste). 남긴 답을 채운 질문지다. 프로필이 없으면 모임 링크로 돌려보낸다
export function TasteScreen({ code }: { code: string }) {
  const router = useRouter();
  const toast = useToast();
  const snapshot = useMeetupSnapshot(code);
  const update = useUpdateTaste(code);
  const data = snapshot.data;
  const me = data && myProfile(data);
  const missing = !!data && !me;
  const leave = useLeave(meetupHref(code));

  useEffect(() => {
    if (missing) router.replace(meetupHref(code));
  }, [missing, code, router]);

  if (isNotFound(snapshot.error)) return <MeetupNotFound />;
  if (!data || !me) {
    return (
      <MeetupLoadingScreen
        title="내 취향 수정"
        snapshot={snapshot}
        onBack={leave}
      />
    );
  }
  return (
    <JoinFormView
      mode="edit"
      questions={data.questions}
      initial={formFromTaste(me.name, me.taste)}
      signedIn={data.me.signedIn}
      pending={update.isPending}
      onBack={leave}
      onSubmit={(form) =>
        update.mutate(toTaste(form, data.questions), {
          onSuccess: () => {
            toast("취향을 고쳤어요");
            leave();
          },
          onError: () =>
            toast("취향을 고치지 못했어요. 잠시 뒤 다시 시도해 주세요"),
        })
      }
    />
  );
}
