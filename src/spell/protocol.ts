// Messages between the UI thread and the spelling worker.

export type ToWorker =
  | { type: "init"; languages: string[]; userWords: string[]; base: string }
  | { type: "check"; id: number; words: string[] }
  | { type: "suggest"; id: number; word: string }
  | { type: "setUserWords"; words: string[] };

export type FromWorker =
  | { type: "log"; message: string }
  | { type: "ready"; languages: string[] }
  | { type: "error"; message: string }
  | { type: "checked"; id: number; wrong: string[] }
  | { type: "suggestions"; id: number; suggestions: string[] };

/** Language code (settings) to dictionary file stem. */
export const DICTIONARIES: Record<string, string> = {
  en: "en_US",
  es: "es_ES",
  gl: "gl_ES",
};
