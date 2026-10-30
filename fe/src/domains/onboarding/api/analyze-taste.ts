import { request } from "@/shared/api/client";
import type { TasteChip } from "../model/answers";

export async function analyzeTaste(
  text: string,
  { signal }: { signal: AbortSignal },
): Promise<TasteChip[]> {
  const response = await request<{ tastes: TasteChip[] }>(
    "/v1/onboarding/taste-analysis",
    {
      method: "POST",
      body: { text },
      signal,
      timeoutMs: 15_000,
    },
  );
  return response.tastes;
}
