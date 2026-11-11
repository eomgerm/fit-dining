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
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

import { rememberLoginReturn } from "../../../login-return";

const withSession: WithSession = (send) => authenticated(() => send());

// 모임 정보 수정(/m/{code}/edit). 고칠 수 있는 사람(EDIT_INFO, EDIT_DATE)이 아니면 모임 링크로 돌려보낸다(AC-30)
export function EditScreen({ code }: { code: string }) {
  const router = useRouter();
  const snapshot = useMeetupSnapshot(code);
  const data = snapshot.data;
  const editable =
    !!data &&
    (data.allowed.includes("EDIT_INFO") || data.allowed.includes("EDIT_DATE"));

  useEffect(() => {
    if (data && !editable) router.replace(meetupHref(code));
  }, [data, editable, code, router]);

  if (isNotFound(snapshot.error)) return <MeetupNotFound />;
  if (!data || !editable) {
    return (
      <Screen>
        <TopBar title="모임 정보 수정" />
      </Screen>
    );
  }
  const back = () => router.replace(meetupHref(code));
  return (
    <MeetupEditForm
      code={code}
      snapshot={data}
      withSession={withSession}
      onBack={back}
      onSaved={back}
      onUnauthorized={() => {
        rememberLoginReturn(`${meetupHref(code)}/edit`);
        router.push("/login");
      }}
    />
  );
}
