import { describe, expect, it } from "vitest";

import { aggressiveCorrection, BUILTIN_RULES, matchCase, safeCorrection } from "../src/spell/autocorrect";
import { editDistance } from "../src/spell/distance";
import { tokenize, wordBefore } from "../src/spell/tokenize";

describe("tokenize", () => {
  it("finds words and skips tags, mentions, urls, paths and acronyms", () => {
    const text = "Ask @maria about #todo items: see https://example.com/x?y=1 or C:\\tmp\\a.txt and ACME's API (v2) — mañana, tamén";
    expect(tokenize(text).map((t) => t.word)).toEqual(["Ask", "about", "items", "see", "or", "and", "v", "mañana", "tamén"]);
  });

  it("keeps offsets and trims trailing apostrophes and hyphens", () => {
    const spans = tokenize("re-open the-- 'quoted' don’t");
    expect(spans).toEqual([
      { word: "re-open", from: 0, to: 7 },
      { word: "the", from: 8, to: 11 },
      { word: "quoted", from: 15, to: 21 },
      { word: "don’t", from: 23, to: 28 },
    ]);
  });

  it("returns the word before an offset unless it is a tag", () => {
    expect(wordBefore("hello teh", 9)).toEqual({ word: "teh", from: 6 });
    expect(wordBefore("hello #teh", 10)).toBeNull();
    expect(wordBefore("hello ", 6)).toBeNull();
  });
});

describe("autocorrect", () => {
  it("applies curated rules with the original case", () => {
    expect(safeCorrection("recieve", BUILTIN_RULES)).toBe("receive");
    expect(safeCorrection("Recieve", BUILTIN_RULES)).toBe("Receive");
    expect(safeCorrection("RECIEVE", BUILTIN_RULES)).toBe("RECEIVE");
    expect(safeCorrection("tambien", BUILTIN_RULES)).toBe("también");
    expect(safeCorrection("hello", BUILTIN_RULES)).toBeNull();
    expect(safeCorrection("tbd", { ...BUILTIN_RULES, tbd: "to be defined" })).toBe("to be defined");
    expect(matchCase("Reunion", "reunión")).toBe("Reunión");
  });

  it("only corrects aggressively when exactly one suggestion is one edit away", () => {
    expect(aggressiveCorrection("xuntansa", ["xuntanza", "xunta", "Xunta"])).toBe("xuntanza");
    expect(aggressiveCorrection("tamen", ["tamén", "maten", "teman", "amen"])).toBeNull();
    expect(aggressiveCorrection("helo", ["hole", "help", "helot", "hello"])).toBeNull();
    expect(aggressiveCorrection("Xoan", ["Xoán"])).toBeNull();
    expect(aggressiveCorrection("abc", ["abd"])).toBeNull();
    expect(aggressiveCorrection("recieve", ["receive", "relieve"])).toBeNull();
    expect(aggressiveCorrection("helo", ["hello"])).toBe("hello");
  });

  it("measures edit distance with transpositions", () => {
    expect(editDistance("teh", "the")).toBe(1);
    expect(editDistance("reunion", "reunión")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});
