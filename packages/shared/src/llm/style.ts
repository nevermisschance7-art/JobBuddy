// House style for generated text: plain, short, human. No em dashes, no buzzwords.
// Safe swaps are applied; anything we can't fix without changing meaning is flagged.
// Over-length text is flagged, never silently cut.

/** Phrase -> plain replacement. Matched case-insensitively at word boundaries. */
const REPLACEMENTS: [RegExp, string][] = [
  [/\bI am passionate about\b/gi, "I care about"],
  [/\bI'm passionate about\b/gi, "I care about"],
  [/\bI am excited to\b/gi, "I'd like to"],
  [/\bI'm excited to\b/gi, "I'd like to"],
  [/\bleveraging\b/gi, "using"],
  [/\bleveraged\b/gi, "used"],
  [/\bleverages\b/gi, "uses"],
  [/\bleverage\b/gi, "use"],
  [/\butili[sz]ing\b/gi, "using"],
  [/\butili[sz]ed\b/gi, "used"],
  [/\butili[sz]e\b/gi, "use"],
  [/\bdelve into\b/gi, "look into"],
  [/\bdelving into\b/gi, "looking into"],
  [/(^|[.!?]\s+)(?:Furthermore|Moreover|Additionally),\s+(\w)/g, "$1$2"],
  [/\b(?:furthermore|moreover)\b/gi, "also"],
];

/** Words with no safe automatic swap. Their presence is reported as a flag. */
export const BANNED_WORDS = [
  "delve",
  "dynamic",
  "fast-paced",
  "synergy",
  "synergies",
  "passionate",
  "rockstar",
  "ninja",
  "go-getter",
  "thought leader",
  "game-changer",
  "cutting-edge",
  "results-driven",
  "detail-oriented",
  "team player",
  "tapestry",
  "testament to",
];

export type StyleResult = {
  text: string;
  wordCount: number;
  overLimit: boolean;
  /** Human-readable notes for the review screen. */
  flags: string[];
};

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function matchCase(original: string, replacement: string): string {
  return original[0] && original[0] === original[0].toUpperCase() && replacement[0]
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement;
}

export function applyStyle(input: string, maxWords: number): StyleResult {
  let text = input.trim();

  // Em dashes, and spaced en dashes used as dashes, become commas. Ranges like 2019–2021 stay.
  text = text.replace(/\s*—\s*/g, ", ").replace(/\s+–\s+/g, ", ");
  // Typographic hyphens and non-breaking spaces (some models use them) become plain ones.
  text = text.replace(/[\u2010\u2011]/g, "-").replace(/[\u00a0\u202f]/g, " ");

  for (const [pattern, replacement] of REPLACEMENTS) {
    text = text.replace(pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      // Sentence-start connector removal keeps the separator and capitalises the next word.
      if (replacement === "$1$2") {
        const sep = args[1] as string;
        const next = args[2] as string;
        return sep + next.toUpperCase();
      }
      return matchCase(match, replacement);
    });
  }

  text = text
    .replace(/,\s*,/g, ",")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const flags: string[] = [];
  const lower = text.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (new RegExp(`\\b${word.replace(/[-\s]/g, "[-\\s]")}\\b`, "i").test(lower)) {
      flags.push(`Uses "${word}". Consider plainer wording.`);
    }
  }

  const wordCount = countWords(text);
  const overLimit = wordCount > maxWords;
  if (overLimit) flags.push(`${wordCount} words, over the ${maxWords}-word limit. Please shorten.`);

  return { text, wordCount, overLimit, flags };
}
