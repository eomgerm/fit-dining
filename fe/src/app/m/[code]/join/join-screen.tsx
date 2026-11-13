"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  conflictOf,
  isNotFound,
  useCreateProfile,
  useMeetupSnapshot,
} from "@/domains/meetup/api/queries";
import {
  EMPTY_JOIN_FORM,
  saveDraft,
  takeDraft,
  toTaste,
  type JoinForm,
} from "@/domains/meetup/model/join-form";
import { markJustJoined } from "@/domains/meetup/model/just-joined";
import {
  meetupHref,
  NAME_MAX,
  type MeetupSnapshot,
} from "@/domains/meetup/model/meetup";
import { FullView } from "@/domains/meetup/ui/full-view";
import { JoinFormView } from "@/domains/meetup/ui/join-form";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";
import { isApiError } from "@/shared/api/api-error";
import { useLeave } from "@/shared/lib/use-leave";
import { useToast } from "@/shared/ui/overlay/toast";

import { rememberLoginReturn } from "../../../login-return";
import { MeetupLoadingScreen } from "../meetup-loading-screen";

// 질문지(/m/{code}/join). 이미 프로필이 있으면 모임 링크로 돌려보낸다
export function JoinScreen({ code }: { code: string }) {
  const router = useRouter();
  const snapshot = useMeetupSnapshot(code);
  const joined = !!snapshot.data?.me.profileId;
  const leave = useLeave(meetupHref(code));

  useEffect(() => {
    if (joined) router.replace(meetupHref(code));
  }, [joined, code, router]);

  if (isNotFound(snapshot.error)) return <MeetupNotFound />;
  if (!snapshot.data || joined) {
    return (
      <MeetupLoadingScreen
        title="처음 참여하기"
        snapshot={snapshot}
        onBack={leave}
      />
    );
  }
  return <JoinBody code={code} snapshot={snapshot.data} />;
}

function JoinBody({
  code,
  snapshot,
}: {
  code: string;
  snapshot: MeetupSnapshot;
}) {
  const router = useRouter();
  const toast = useToast();
  const create = useCreateProfile(code);
  const host = snapshot.me.role === "HOST";
  const leaveToList = useLeave("/m");
  const leave = useLeave(meetupHref(code));
  const [full, setFull] = useState(false);
  const [takenName, setTakenName] = useState<string>();
  // 로그인하러 갔다 돌아오면 쓰던 답을 채운다(AC-28). 모임장은 닉네임을 이름에 넣어 둔다
  const [initial] = useState<JoinForm>(
    () =>
      takeDraft(code) ?? {
        ...EMPTY_JOIN_FORM,
        name: host
          ? Array.from(snapshot.info.hostNickname ?? "")
              .slice(0, NAME_MAX)
              .join("")
          : "",
      },
  );
  const pickName = () => router.push(`${meetupHref(code)}/profiles`);
  const viewOnly = () => router.replace(meetupHref(code));

  if (full) return <FullView onPickName={pickName} onViewOnly={viewOnly} />;

  return (
    <JoinFormView
      mode={host ? "host" : "guest"}
      hostNickname={snapshot.info.hostNickname}
      questions={snapshot.questions}
      initial={initial}
      signedIn={snapshot.me.signedIn}
      pending={create.isPending}
      takenName={takenName}
      onBack={host ? leaveToList : leave}
      onPickName={pickName}
      onSignIn={(form) => {
        saveDraft(code, form);
        rememberLoginReturn(`${meetupHref(code)}/join`);
        router.push("/login");
      }}
      onSubmit={(form) => {
        const name = form.name.trim();
        create.mutate(
          { name, taste: toTaste(form, snapshot.questions) },
          {
            onSuccess: () => {
              if (!host) markJustJoined(code);
              router.replace(meetupHref(code));
            },
            onError: (error) => {
              const conflict = conflictOf(error);
              if (conflict === "name-taken") setTakenName(name);
              else if (conflict === "full") setFull(true);
              else if (conflict === "already-joined") {
                toast("이미 이 모임에 참여했어요");
                router.replace(meetupHref(code));
              } else if (isApiError(error) && error.status === 429)
                toast("잠시 뒤 다시 시도해 주세요");
              else toast("취향을 남기지 못했어요. 잠시 뒤 다시 시도해 주세요");
            },
          },
        );
      }}
    />
  );
}
