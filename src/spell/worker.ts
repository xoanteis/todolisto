/// <reference lib="webworker" />
// Spelling worker: real Hunspell (compiled to WebAssembly) with the bundled
// dictionaries. A word is accepted when any active dictionary accepts it.

import { editDistance } from "./distance";
import { loadHunspell, type HunspellInstance, type HunspellRuntime } from "./hunspell";
import { DICTIONARIES, type FromWorker, type ToWorker } from "./protocol";

let runtime: HunspellRuntime | null = null;
let instances: { lang: string; hunspell: HunspellInstance }[] = [];
let userWords: string[] = [];

const post = (message: FromWorker) => self.postMessage(message);
const log = (message: string) => post({ type: "log", message });

async function init(languages: string[], words: string[], base: string) {
  for (const i of instances) i.hunspell.dispose();
  instances = [];
  log("loading the Hunspell runtime");
  runtime ??= await loadHunspell(log);
  log("runtime ready");
  for (const lang of languages) {
    const stem = DICTIONARIES[lang];
    if (!stem) continue;
    const [aff, dic] = await Promise.all(
      [`${stem}.aff`, `${stem}.dic`].map(async (file) => {
        const url = new URL(`dict/${file}`, base).href;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`cannot load ${file}: HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      }),
    );
    const affPath = runtime.mount(`${stem}.aff`, aff);
    const dicPath = runtime.mount(`${stem}.dic`, dic);
    const started = Date.now();
    instances.push({ lang, hunspell: runtime.create(affPath, dicPath) });
    log(`${stem} loaded in ${Date.now() - started} ms`);
  }
  setUserWords(words);
  post({ type: "ready", languages: instances.map((i) => i.lang) });
}

function setUserWords(words: string[]) {
  for (const i of instances) {
    for (const w of userWords) i.hunspell.removeWord(w);
    for (const w of words) i.hunspell.addWord(w);
  }
  userWords = [...words];
}

function isCorrect(word: string): boolean {
  if (instances.some((i) => i.hunspell.spell(word))) return true;
  // Dictionaries spell contractions with a straight apostrophe.
  const straight = word.replace(/’/g, "'");
  return straight !== word && instances.some((i) => i.hunspell.spell(straight));
}

function suggest(word: string): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const i of instances) {
    for (const s of i.hunspell.suggest(word)) {
      if (!seen.has(s)) {
        seen.add(s);
        merged.push(s);
      }
    }
  }
  const lower = word.toLowerCase();
  return merged
    .map((s, index) => ({ s, index, d: editDistance(lower, s.toLowerCase()) }))
    .sort((a, b) => a.d - b.d || a.index - b.index)
    .slice(0, 8)
    .map((x) => x.s);
}

log("worker started");

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init":
        init(msg.languages, msg.userWords, msg.base).catch((e) => post({ type: "error", message: String(e) }));
        break;
      case "check":
        post({ type: "checked", id: msg.id, wrong: msg.words.filter((w) => !isCorrect(w)) });
        break;
      case "suggest":
        post({ type: "suggestions", id: msg.id, suggestions: suggest(msg.word) });
        break;
      case "setUserWords":
        setUserWords(msg.words);
        break;
    }
  } catch (e) {
    post({ type: "error", message: String(e) });
  }
};
