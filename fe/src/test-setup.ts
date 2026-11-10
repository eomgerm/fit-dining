import { beforeEach } from "vitest";

// Browser API tests start with a CSRF cookie; bootstrap behavior has dedicated tests.
beforeEach(() => {
  if (typeof document !== "undefined")
    document.cookie = "XSRF-TOKEN=test-csrf; Path=/";
});
