"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";

import { isApiError } from "@/shared/api/api-error";
import { cn } from "@/shared/lib/cn";
import { BookmarkIcon } from "@/shared/ui/icon/icons/bookmark";
import { BookmarkFilledIcon } from "@/shared/ui/icon/icons/bookmark-filled";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { useToast } from "@/shared/ui/overlay/toast";

import { removeBookmark, saveBookmark } from "../api/bookmark-api";
import { bookmarkKeys, bookmarkQueries } from "../api/bookmark-queries";
import { BookmarkAccountChanged, type BookmarkAccess } from "../model/bookmark";
import { LoginPrompt, SAVE_LOGIN_MESSAGE } from "./login-prompt";

const NETWORK_MESSAGE = "인터넷 연결을 확인하고 다시 시도해 주세요.";

// RT 갱신을 거쳐도 401이면 세션이 끝났다(D-7)
export function isSessionEnded(error: unknown) {
  return isApiError(error) && error.status === 401;
}

type Look = "checking" | "retry" | "saved" | "unsaved";

// 장소 상세 하단 막대의 저장 버튼(와이어프레임 DetailSaved, DetailSaveFail, StartGuest, D-5).
// returnTo는 로그인 안내에서 [로그인]을 골랐을 때 돌아올 주소다
export function BookmarkButton({
  placeId,
  access,
  returnTo,
}: {
  placeId: number;
  access: BookmarkAccess;
  returnTo: string;
}) {
  const [prompting, setPrompting] = useState(false);
  const { session } = access;

  function endSession(prompt: boolean) {
    access.endSession();
    if (prompt) setPrompting(true);
  }

  return (
    <>
      {session.status === "user" ? (
        // 계정이 바뀌면 새로 그려 이전 계정의 요청 상태를 버린다(AC-15)
        <UserBookmarkButton
          key={session.userId}
          placeId={placeId}
          userId={session.userId}
          access={access}
          onSessionEnded={endSession}
        />
      ) : (
        <SaveButtonView
          look={session.status === "checking" ? "checking" : "unsaved"}
          onClick={() => setPrompting(true)}
        />
      )}
      <LoginPrompt
        open={prompting}
        description={SAVE_LOGIN_MESSAGE}
        onCancel={() => setPrompting(false)}
        onLogin={() => {
          setPrompting(false);
          access.login(returnTo);
        }}
      />
    </>
  );
}

function UserBookmarkButton({
  placeId,
  userId,
  access,
  onSessionEnded,
}: {
  placeId: number;
  userId: string;
  access: BookmarkAccess;
  // prompt가 true면 사용자가 누른 요청이라 로그인 안내를 띄운다
  onSessionEnded: (prompt: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery(bookmarkQueries.status(access, userId, placeId));
  const write = useMutation({
    networkMode: "always",
    mutationFn: (save: boolean) =>
      access.send(userId, (token) =>
        save ? saveBookmark(placeId, token) : removeBookmark(placeId, token),
      ),
  });
  // 실패 뒤 저장 여부를 다시 확인하는 중. 결과가 올 때까지 버튼을 확정하지 않는다
  const [rechecking, setRechecking] = useState(false);
  // 방금 눌러 저장에 성공했는지. 화면을 열 때나 다시 확인해 저장으로 보일 때는 아이콘이 커지지 않는다
  const [justSaved, setJustSaved] = useState(false);

  // 화면을 열 때 저절로 나간 조회가 401이면 창 없이 비로그인 모양으로 둔다(AC-17)
  const sessionEnded = isSessionEnded(status.error);
  const endQuietly = useEffectEvent(() => onSessionEnded(false));
  useEffect(() => {
    if (sessionEnded) endQuietly();
  }, [sessionEnded]);

  const stillMine = () => access.currentUserId() === userId;
  // 세션이 끝난 401이라도 그사이 다른 계정으로 바뀌었으면 새 계정의 세션을 지우지 않고 결과를 버린다(AC-15).
  // 갱신 실패로 이미 로그인 정보가 지워졌으면(사용자 없음) 이 계정의 세션 종료다
  const endSessionIfMine = () => {
    const current = access.currentUserId();
    if (current === undefined || current === userId) onSessionEnded(true);
  };

  async function recheck(networkToast: boolean) {
    setRechecking(true);
    const result = await status.refetch();
    setRechecking(false);
    if (!result.isError) return;
    if (isSessionEnded(result.error)) endSessionIfMine();
    else if (networkToast && stillMine()) toast(NETWORK_MESSAGE);
  }

  async function toggle(save: boolean) {
    setJustSaved(false);
    try {
      await write.mutateAsync(save);
    } catch (error) {
      if (error instanceof BookmarkAccountChanged) return;
      if (isSessionEnded(error)) return endSessionIfMine();
      if (!stillMine()) return;
      const failed = save
        ? "저장하지 못했어요. 다시 시도해 주세요."
        : "저장을 해제하지 못했어요. 다시 시도해 주세요.";
      // 4xx는 바뀐 것이 없어 누르기 전 상태로 둔다
      if (
        isApiError(error) &&
        error.kind === "http" &&
        (error.status ?? 0) < 500
      ) {
        return toast(failed);
      }
      // 시간 초과·연결 끊김은 결과를 모르므로 토스트 없이 다시 확인한다
      const unclear = isApiError(error) && error.kind !== "http";
      if (!unclear) toast(failed);
      return recheck(unclear);
    }
    if (!stillMine()) return;
    setJustSaved(save);
    queryClient.setQueryData(bookmarkKeys.status(userId, placeId), {
      bookmarked: save,
    });
    void queryClient.invalidateQueries({
      queryKey: bookmarkKeys.lists(userId),
    });
    toast(save ? "저장했어요" : "저장을 해제했어요");
  }

  const look: Look =
    rechecking || status.isPending
      ? "checking"
      : status.isError
        ? "retry"
        : status.data.bookmarked
          ? "saved"
          : "unsaved";

  return (
    <SaveButtonView
      look={look}
      pop={justSaved}
      disabled={write.isPending}
      onClick={() => {
        if (look === "retry") void recheck(false);
        else void toggle(look === "unsaved");
      }}
    />
  );
}

const LABELS: Record<Look, string> = {
  checking: "저장 상태 확인 중",
  retry: "저장 상태 다시 확인",
  saved: "저장 해제",
  unsaved: "저장",
};

// 와이어프레임의 정사각형 테두리 버튼. 공통 Button에 아이콘만 있는 크기가 없어 직접 그린다
function SaveButtonView({
  look,
  pop,
  disabled,
  onClick,
}: {
  look: Look;
  // 채운 북마크가 나타날 때 작게 커졌다 돌아온다. 움직임 줄이기에서는 투명도만 120ms로 바뀐다
  pop?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const pressable = look === "saved" || look === "unsaved";
  return (
    <button
      type="button"
      aria-label={LABELS[look]}
      aria-pressed={pressable ? look === "saved" : undefined}
      disabled={disabled || look === "checking"}
      onClick={onClick}
      className="flex size-13 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface transition active:bg-surface-sunken"
    >
      {look === "checking" && (
        <span
          aria-hidden
          className="size-5 animate-spin rounded-full border-2 border-icon-subtle border-r-transparent motion-reduce:animate-none"
        />
      )}
      {look === "retry" && <RefreshIcon className="text-icon" />}
      {look === "saved" && (
        <span
          className={cn(
            "flex",
            pop &&
              "motion-safe:animate-bookmark-pop motion-reduce:transition-opacity motion-reduce:starting:opacity-0",
          )}
        >
          <BookmarkFilledIcon className="text-primary" />
        </span>
      )}
      {look === "unsaved" && <BookmarkIcon className="text-icon" />}
    </button>
  );
}
