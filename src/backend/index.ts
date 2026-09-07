import { createMemoryBackend } from "./memory";
import { tauriBackend } from "./tauri";
import type { Backend } from "./types";

export function createBackend(): Backend {
  return "__TAURI_INTERNALS__" in window ? tauriBackend : createMemoryBackend();
}
