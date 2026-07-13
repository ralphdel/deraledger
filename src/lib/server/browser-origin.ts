type BrowserMutationOriginErrorCode =
  | "SOLO_PLUS_BROWSER_ORIGIN_REQUIRED"
  | "SOLO_PLUS_BROWSER_ORIGIN_INVALID"
  | "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH";

export class BrowserMutationOriginError extends Error {
  readonly code: BrowserMutationOriginErrorCode;

  constructor(code: BrowserMutationOriginErrorCode, message: string) {
    super(message);
    this.name = "BrowserMutationOriginError";
    this.code = code;
  }
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasUnsafeOriginCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F\s]/.test(value);
}

function parseTrustedOrigin(value: string): URL | null {
  if (!hasNonEmptyString(value)) {
    return null;
  }

  if (value !== value.trim() || hasUnsafeOriginCharacters(value)) {
    return null;
  }

  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string | null | undefined): string | null {
  return parseTrustedOrigin(value ?? "")?.origin ?? null;
}

function normalizeForwardedOrigin(headers: Headers): string | null {
  const rawForwardedProto = headers.get("x-forwarded-proto");
  const rawForwardedHost = headers.get("x-forwarded-host");

  if (
    !hasNonEmptyString(rawForwardedProto) ||
    !hasNonEmptyString(rawForwardedHost) ||
    rawForwardedProto.includes(",") ||
    rawForwardedHost.includes(",")
  ) {
    return null;
  }

  const forwardedProto = rawForwardedProto.trim();
  const forwardedHost = rawForwardedHost.trim();

  if (!hasNonEmptyString(forwardedProto) || !hasNonEmptyString(forwardedHost)) {
    return null;
  }

  if (
    hasUnsafeOriginCharacters(forwardedProto) ||
    hasUnsafeOriginCharacters(forwardedHost) ||
    !/^(https?)$/i.test(forwardedProto) ||
    !/^[a-z0-9.-]+(?::\d+)?$/i.test(forwardedHost)
  ) {
    return null;
  }

  return normalizeOrigin(`${forwardedProto.toLowerCase()}://${forwardedHost.toLowerCase()}`);
}

function collectAllowedOrigins(request: Request, env: NodeJS.ProcessEnv): Set<string> {
  const allowedOrigins = new Set<string>();
  const requestOrigin = new URL(request.url).origin;
  allowedOrigins.add(requestOrigin);

  for (const candidate of [env.CANONICAL_APP_URL, env.APP_URL, env.NEXT_PUBLIC_APP_URL]) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) {
      allowedOrigins.add(normalized);
    }
  }

  const forwardedOrigin = normalizeForwardedOrigin(request.headers);
  if (forwardedOrigin && allowedOrigins.has(forwardedOrigin)) {
    allowedOrigins.add(forwardedOrigin);
  }

  return allowedOrigins;
}

export function assertSameOriginBrowserMutationRequest(
  request: Request,
  options: { env?: NodeJS.ProcessEnv } = {},
): { origin: string; requestOrigin: string } {
  const originHeader = request.headers.get("origin");
  if (!hasNonEmptyString(originHeader)) {
    throw new BrowserMutationOriginError(
      "SOLO_PLUS_BROWSER_ORIGIN_REQUIRED",
      "Browser mutation requests must include an Origin header.",
    );
  }

  const origin = parseTrustedOrigin(originHeader);
  if (!origin) {
    throw new BrowserMutationOriginError(
      "SOLO_PLUS_BROWSER_ORIGIN_INVALID",
      "Browser mutation request Origin header is invalid.",
    );
  }

  const requestUrl = new URL(request.url);
  if ((requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") || requestUrl.username !== "" || requestUrl.password !== "") {
    throw new BrowserMutationOriginError(
      "SOLO_PLUS_BROWSER_ORIGIN_INVALID",
      "Browser mutation request origin boundary is invalid.",
    );
  }

  const requestOrigin = requestUrl.origin;
  const allowedOrigins = collectAllowedOrigins(request, options.env ?? process.env);

  if (!allowedOrigins.has(origin.origin)) {
    throw new BrowserMutationOriginError(
      "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
      "Browser mutation request Origin header does not match the request origin.",
    );
  }

  return {
    origin: origin.origin,
    requestOrigin,
  };
}
