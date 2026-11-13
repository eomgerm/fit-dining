"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { authenticated } from "@/domains/auth/api/authenticated";
import {
  isNotFound,
  useMeetupSnapshot,
  type WithSession,
} from "@/domains/meetup/api/queries";
import { meetupHref } from "@/domains/meetup/model/meetup";
import { MeetupEditForm } from "@/domains/meetup/ui/meetup-edit-form";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";
import { useLeave } from "@/shared/lib/use-leave";

import { rememberLoginReturn } from "../../../login-return";
import { MeetupLoadingScreen } from "../meetup-loading-screen";

const withSession: WithSession = (send) => authenticated(() => send());

// 모임 정보 수정(/m/{code}/edit). 고칠 수 있는 사람(EDIT_INFO, EDIT_DATE)이 아니면 모임 링크로 돌려보낸다(AC-30)
export function EditScreen({ code }: { code: string }) {
  const router = useRouter();
  const snapshot = useMeetupSnapshot(code);
  const data = snapshot.data;
  const editable =
    !!data &&
    (data.allowed.includes("EDIT_INFO") || data.allowed.includes("EDIT_DATE"));
  const leave = useLeave(meetupHref(code));

  useEffect(() => {
    if (data && !editable) router.replace(meetupHref(code));
  }, [data, editable, code, router]);

  if (isNotFound(snapshot.error)) return <MeetupNotFound />;
  if (!data || !editable) {
    return (
      <MeetupLoadingScreen
        title="모임 정보 수정"
        snapshot={snapshot}
        onBack={leave}
      />
    );
  }
  return (
    <MeetupEditForm
      code={code}
      snapshot={data}
      withSession={withSession}
      onBack={leave}
      onSaved={leave}
      onUnauthorized={() => {
        rememberLoginReturn(`${meetupHref(code)}/edit`);
        router.push("/login");
      }}
    />
  );
}
