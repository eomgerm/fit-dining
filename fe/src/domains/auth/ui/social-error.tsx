"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/shared/ui/overlay/toast";
export function SocialError() {
  const router = useRouter();
  const toast = useToast();
  const shown = useRef(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("error") !== "social" || shown.current) return;
    shown.current = true;
    toast("로그인하지 못했어요. 다시 시도해 주세요.");
    url.searchParams.delete("error");
    router.replace(url.pathname + url.search + url.hash);
  }, [router, toast]);
  return null;
}
