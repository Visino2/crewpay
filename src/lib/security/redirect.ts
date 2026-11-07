const PLACEHOLDER_ORIGIN = "http://crewpay.invalid";

/**
 * Returns `candidate` only if it is a same-site relative path; otherwise
 * `fallback`. Prevents open redirects through `next` parameters.
 */
export function safeRedirectPath(candidate: unknown, fallback = "/account"): string {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) {
    return fallback;
  }
  // Reject protocol-relative ("//host"), backslash tricks and control characters.
  if (!candidate.startsWith("/") || candidate.startsWith("//") || /[\\\u0000-\u001f]/.test(candidate)) {
    return fallback;
  }
  try {
    const url = new URL(candidate, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
