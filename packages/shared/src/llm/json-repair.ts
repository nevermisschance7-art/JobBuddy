// Models often wrap JSON in markdown fences, add a sentence before it, or slip in
// invisible characters. This pulls out the JSON value and parses it.

const INVISIBLE = /[​-‍⁠﻿­]/g;

export function stripToJson(raw: string): string {
  let s = raw.replace(INVISIBLE, "").trim();
  const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.search(/[{[]/);
  if (start === -1) return s;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  return end > start ? s.slice(start, end + 1) : s.slice(start);
}

/** Parses model output as JSON. Throws SyntaxError if it still isn't valid. */
export function parseLooseJson(raw: string): unknown {
  return JSON.parse(stripToJson(raw));
}
