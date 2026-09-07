// UI-thread side of the spelling worker: caches verdicts per word so the
// editor can build underlines synchronously and only asks for unknown words.

import type { FromWorker, ToWorker } from "./protocol";

export type SpellStatus = "idle" | "loading" | "ready" | "error" | "off";

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

export class SpellClient {
  status: SpellStatus = "idle";
  languages: string[] = [];
  error: string | null = null;

  private worker: Worker | null = null;
  private readonly cache = new Map<string, boolean>();
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  init(languages: string[], userWords: string[]) {
    if (!this.worker) {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
      this.worker.onerror = (event) => this.fail(event.message || "spelling worker failed");
    }
    this.cache.clear();
    this.setStatus("loading");
    this.send({ type: "init", languages, userWords, base: document.baseURI });
  }

  disable() {
    this.setStatus("off");
  }

  /** `true`/`false` when the verdict is cached, `undefined` otherwise. */
  isKnown(word: string): boolean | undefined {
    return this.cache.get(word);
  }

  async check(words: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    const unknown = [...new Set(words)].filter((w) => {
      const cached = this.cache.get(w);
      if (cached !== undefined) result.set(w, cached);
      return cached === undefined;
    });
    if (unknown.length && this.status === "ready") {
      const wrong = new Set((await this.request<{ wrong: string[] }>({ type: "check", id: 0, words: unknown })).wrong);
      for (const w of unknown) {
        const ok = !wrong.has(w);
        this.cache.set(w, ok);
        result.set(w, ok);
      }
    }
    return result;
  }

  async suggest(word: string): Promise<string[]> {
    if (this.status !== "ready") return [];
    return (await this.request<{ suggestions: string[] }>({ type: "suggest", id: 0, word })).suggestions;
  }

  /** The user words replace the previous set (they are per profile). */
  setUserWords(words: string[]) {
    for (const w of words) this.cache.set(w, true);
    this.send({ type: "setUserWords", words });
  }

  addWord(word: string, allWords: string[]) {
    this.cache.set(word, true);
    this.setUserWords(allWords);
  }

  onStatus(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("spelling worker disposed"));
    this.pending.clear();
  }

  private request<T>(message: Extract<ToWorker, { id: number }>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.send({ ...message, id });
    });
  }

  private send(message: ToWorker) {
    this.worker?.postMessage(message);
  }

  private receive(message: FromWorker) {
    switch (message.type) {
      case "log":
        if (import.meta.env.DEV) console.debug(`[spell] ${message.message}`);
        break;
      case "ready":
        this.languages = message.languages;
        this.error = null;
        this.setStatus("ready");
        break;
      case "error":
        this.fail(message.message);
        break;
      case "checked":
      case "suggestions": {
        const p = this.pending.get(message.id);
        this.pending.delete(message.id);
        p?.resolve(message);
        break;
      }
    }
  }

  private fail(message: string) {
    this.error = message;
    this.setStatus("error");
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }

  private setStatus(status: SpellStatus) {
    this.status = status;
    for (const l of this.listeners) l();
  }
}
