// Splits note text into the words worth spell-checking. Tags (#todo),
// mentions (@maria), URLs, e-mail addresses, paths and ALL-CAPS acronyms are
// left alone: they are never in a dictionary and underlining them is noise.

export interface WordSpan {
  word: string;
  from: number;
  to: number;
}

const WORD_CHARS = "[\\p{L}\\p{M}][\\p{L}\\p{M}'’-]*";

export function tokenize(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const skip: Array<[number, number]> = [];
  const chunk = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = chunk.exec(text))) {
    if (/:\/\/|^www\.|@|[\\/]/.test(m[0])) skip.push([m.index, m.index + m[0].length]);
  }
  const word = new RegExp(WORD_CHARS, "gu");
  while ((m = word.exec(text))) {
    let w = m[0];
    const from = m.index;
    let to = from + w.length;
    while (w.length && /['’-]$/.test(w)) {
      w = w.slice(0, -1);
      to -= 1;
    }
    if (!w) continue;
    if (skip.some(([s, e]) => from >= s && to <= e)) continue;
    const previous = from > 0 ? text[from - 1] : "";
    if (previous === "#" || previous === "@") continue;
    const letters = w.replace(/['’]s$/i, "").replace(/['’-]/g, "");
    if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) continue;
    spans.push({ word: w, from, to });
  }
  return spans;
}

/** The word that ends right before `offset` in `text`, if any. */
export function wordBefore(text: string, offset: number): { word: string; from: number } | null {
  const head = text.slice(0, offset);
  const m = /[\p{L}\p{M}'’-]+$/u.exec(head);
  if (!m) return null;
  const from = offset - m[0].length;
  const previous = from > 0 ? head[from - 1] : "";
  if (previous === "#" || previous === "@") return null;
  return { word: m[0], from };
}
