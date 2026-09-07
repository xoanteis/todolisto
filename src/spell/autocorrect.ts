import { editDistance } from "./distance";

export type AutocorrectLevel = "off" | "safe" | "aggressive";

/** Characters that end a word while typing. */
export const BOUNDARY = /[\s.,;:!?)\]}"'»”]/;

// Curated, unambiguous typos: none of the keys is a valid word in English,
// Spanish or Galician. `npm run validate:rules` checks that against the
// bundled dictionaries (Galician accepts "teh" and "adn", English accepts
// "reunion", so those popular typos cannot be corrected blindly).
export const BUILTIN_RULES: Record<string, string> = {
  // English
  recieve: "receive",
  seperate: "separate",
  definately: "definitely",
  occured: "occurred",
  untill: "until",
  wich: "which",
  thier: "their",
  becuase: "because",
  wierd: "weird",
  acheive: "achieve",
  beleive: "believe",
  tommorow: "tomorrow",
  enviroment: "environment",
  goverment: "government",
  // Spanish
  qeu: "que",
  porqe: "porque",
  tambien: "también",
  aqui: "aquí",
  informacion: "información",
  proximo: "próximo",
  proxima: "próxima",
  rapido: "rápido",
  facil: "fácil",
  dificil: "difícil",
  // Galician
  tamen: "tamén",
  ainda: "aínda",
  xuntansa: "xuntanza",
};

/** Applies the case pattern of `source` to `replacement`. */
export function matchCase(source: string, replacement: string): string {
  if (source.length > 1 && source === source.toUpperCase() && source !== source.toLowerCase()) {
    return replacement.toUpperCase();
  }
  const first = source[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Curated list lookup, case-insensitive on the key. */
export function safeCorrection(word: string, rules: Record<string, string>): string | null {
  const replacement = rules[word.toLowerCase()];
  if (!replacement || replacement === word) return null;
  return matchCase(word, replacement);
}

/**
 * Dictionary-based correction: only when exactly one suggestion is one edit
 * away from the typed word, the word is at least four letters long and not
 * capitalised (names are never touched).
 */
export function aggressiveCorrection(word: string, suggestions: string[]): string | null {
  if (word.length < 4 || suggestions.length === 0) return null;
  if (/^\p{Lu}/u.test(word)) return null;
  const lower = word.toLowerCase();
  const close = suggestions.filter((s) => editDistance(lower, s.toLowerCase()) === 1);
  if (close.length !== 1) return null;
  return matchCase(word, close[0]);
}
