import {
  restore,
  clearSession,
  getSession,
  type AuthSession,
} from "./auth-client";
import { isApiError } from "@/shared/api/api-error";
import { clearSignedIn, signedInMarks } from "../model/signed-in-cookie";

// Cookie authentication needs no token refresh or mutation retry.
export async function authenticated<T>(
  send: (session: AuthSession) => Promise<T>,
): Promise<T> {
  const current = await restore();
  const marks = signedInMarks();
  try {
    return await send(current);
  } catch (error) {
    if (isApiError(error) && error.status === 401 && getSession() === current) {
      clearSession();
      clearSignedIn(marks);
    }
    throw error;
  }
}
