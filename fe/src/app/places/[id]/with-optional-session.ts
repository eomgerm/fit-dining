// Public review lists are personalized by the browser session cookie.
export async function withOptionalSession<T>(
  send: () => Promise<T>,
): Promise<T> {
  return send();
}
