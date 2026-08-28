import "server-only";

export type AdminReadinessJsonDenialCode =
  | "invalid_content_type"
  | "body_too_large"
  | "malformed_json"
  | "duplicate_json_key"
  | "json_depth_exceeded"
  | "invalid_command_root";

export type AdminReadinessJsonResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; code: AdminReadinessJsonDenialCode };

const DEFAULT_MAX_BYTES = 8_192;
const DEFAULT_MAX_DEPTH = 16;

function whitespace(character: string | undefined): boolean {
  return character === " " || character === "\n" || character === "\r" || character === "\t";
}

/** A bounded lexical pass detects duplicate decoded object member names before JSON.parse can discard them. */
function scanObjectMembers(raw: string, maxDepth: number): AdminReadinessJsonDenialCode | null {
  let cursor = 0;
  const skip = () => { while (whitespace(raw[cursor])) cursor += 1; };
  const string = (): { value: string } | null => {
    if (raw[cursor] !== '"') return null;
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < raw.length) {
      const current = raw[cursor++];
      if (escaped) {
        if (current === "u") {
          const digits = raw.slice(cursor, cursor + 4);
          if (!/^[0-9a-f]{4}$/i.test(digits)) return null;
          cursor += 4;
        } else if (!'"\\/bfnrt'.includes(current)) return null;
        escaped = false;
      } else if (current === "\\") escaped = true;
      else if (current === '"') {
        try { return { value: JSON.parse(raw.slice(start, cursor)) as string }; } catch { return null; }
      } else if (current.charCodeAt(0) < 0x20) return null;
    }
    return null;
  };
  const value = (depth: number): AdminReadinessJsonDenialCode | null => {
    if (depth > maxDepth) return "json_depth_exceeded";
    skip();
    if (raw[cursor] === '"') return string() ? null : "malformed_json";
    if (raw[cursor] === "{") {
      cursor += 1; skip();
      const names = new Set<string>();
      if (raw[cursor] === "}") { cursor += 1; return null; }
      while (cursor < raw.length) {
        skip(); const member = string();
        if (!member) return "malformed_json";
        if (names.has(member.value)) return "duplicate_json_key";
        names.add(member.value); skip();
        if (raw[cursor++] !== ":") return "malformed_json";
        const nested = value(depth + 1); if (nested) return nested;
        skip();
        if (raw[cursor] === "}") { cursor += 1; return null; }
        if (raw[cursor++] !== ",") return "malformed_json";
      }
      return "malformed_json";
    }
    if (raw[cursor] === "[") {
      cursor += 1; skip();
      if (raw[cursor] === "]") { cursor += 1; return null; }
      while (cursor < raw.length) {
        const nested = value(depth + 1); if (nested) return nested;
        skip(); if (raw[cursor] === "]") { cursor += 1; return null; }
        if (raw[cursor++] !== ",") return "malformed_json";
      }
      return "malformed_json";
    }
    const scalar = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(cursor));
    if (!scalar) return "malformed_json";
    cursor += scalar[0].length;
    return null;
  };
  const outcome = value(0); skip();
  return outcome ?? (cursor === raw.length ? null : "malformed_json");
}

export function readAdminReadinessJsonBody(input: {
  contentType: string | null | undefined;
  rawBody: string;
  maxBytes?: number;
  maxDepth?: number;
}): AdminReadinessJsonResult {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(input.contentType ?? "")) return { ok: false, code: "invalid_content_type" };
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || new TextEncoder().encode(input.rawBody).byteLength > maxBytes) return { ok: false, code: "body_too_large" };
  const scan = scanObjectMembers(input.rawBody, input.maxDepth ?? DEFAULT_MAX_DEPTH);
  if (scan) return { ok: false, code: scan };
  try {
    const parsed: unknown = JSON.parse(input.rawBody);
    if (!parsed || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) return { ok: false, code: "invalid_command_root" };
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch { return { ok: false, code: "malformed_json" }; }
}
