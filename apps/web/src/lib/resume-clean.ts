// Tidies form output before schema validation: empty strings become undefined,
// empty list items are dropped, and bare domains get https:// so URL checks pass.

const URL_KEYS = new Set(["url"]);

export function cleanResume(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    const v = value.trim();
    if (v === "") return undefined;
    if (key && URL_KEYS.has(key) && !/^https?:\/\//i.test(v)) return `https://${v}`;
    return v;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanResume(item))
      .filter(
        (item) => item !== undefined && !(isPlainObject(item) && Object.keys(item).length === 0),
      );
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = cleanResume(v, k);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
