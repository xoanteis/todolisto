// Minimal driver for the Hunspell WebAssembly build. hunspell-asm's own loader
// relies on CommonJS `require` semantics that do not survive ESM bundling, so
// the Emscripten module is initialised here directly.

interface EmscriptenFS {
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array, options?: { encoding: "binary" }): void;
  unlink(path: string): void;
}

interface EmscriptenModule {
  FS: EmscriptenFS;
  cwrap(name: string, returnType: string | null, argumentTypes: string[]): (...args: number[]) => number;
  allocateUTF8(text: string): number;
  getValue(pointer: number, type: string): number;
  UTF8ToString(pointer: number): string;
  _malloc(size: number): number;
  _free(pointer: number): void;
}

type Factory = (config: Record<string, unknown>) => EmscriptenModule;
type Log = (message: string) => void;

export interface HunspellInstance {
  spell(word: string): boolean;
  suggest(word: string): string[];
  addWord(word: string): void;
  removeWord(word: string): void;
  dispose(): void;
}

export interface HunspellRuntime {
  /** Copies a dictionary file into the in-memory filesystem; returns its path. */
  mount(fileName: string, data: Uint8Array): string;
  create(affPath: string, dicPath: string): HunspellInstance;
}

const POINTER_SIZE = 4;

async function resolveFactory(): Promise<Factory> {
  // Emscripten decides it runs in a worker by looking for `importScripts`,
  // which module workers do not have; without it the runtime never fetches
  // its WebAssembly. The shim is installed before the runtime is evaluated.
  const scope = globalThis as unknown as Record<string, unknown>;
  if (typeof scope.importScripts !== "function" && typeof scope.window === "undefined") {
    scope.importScripts = () => {
      throw new Error("importScripts is not available in module workers");
    };
  }
  const ns = (await import("hunspell-asm/dist/esm/lib/browser/hunspell.js")) as unknown as { default?: Factory } | Factory;
  const factory = typeof ns === "function" ? ns : ns.default;
  if (typeof factory !== "function") throw new Error("Hunspell runtime factory not found");
  return factory;
}

function initialise(factory: Factory, log: Log): Promise<EmscriptenModule> {
  return new Promise<EmscriptenModule>((resolve, reject) => {
    let created: EmscriptenModule | null = null;
    let ready = false;
    const config: Record<string, unknown> = {
      print: (text: string) => log(`stdout: ${text}`),
      printErr: (text: string) => log(`stderr: ${text}`),
      onRuntimeInitialized: () => {
        ready = true;
        log("runtime initialised");
        if (created) resolve(created);
      },
      onAbort: (reason: unknown) => {
        log(`runtime aborted: ${String(reason)}`);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
    };
    try {
      created = factory(config);
    } catch (e) {
      log(`factory threw: ${String(e)}`);
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    // Emscripten gives the module a `then` method; a promise resolving with
    // it would treat it as a thenable that resolves to itself and never settle.
    delete (created as unknown as Record<string, unknown>).then;
    if (ready) resolve(created);
  });
}

export async function loadHunspell(log: Log = () => {}): Promise<HunspellRuntime> {
  const module = await initialise(await resolveFactory(), log);
  const root = `/dict-${Date.now().toString(36)}`;
  module.FS.mkdir(root);

  const api = {
    create: module.cwrap("Hunspell_create", "number", ["number", "number"]),
    destroy: module.cwrap("Hunspell_destroy", null, ["number"]),
    spell: module.cwrap("Hunspell_spell", "number", ["number", "number"]),
    suggest: module.cwrap("Hunspell_suggest", "number", ["number", "number", "number"]),
    freeList: module.cwrap("Hunspell_free_list", null, ["number", "number", "number"]),
    add: module.cwrap("Hunspell_add", "number", ["number", "number"]),
    remove: module.cwrap("Hunspell_remove", "number", ["number", "number"]),
  };

  /** Runs `fn` with C strings for `params`, freeing them afterwards. */
  const withStrings = (params: string[], fn: (...pointers: number[]) => number): number => {
    const pointers = params.map((p) => module.allocateUTF8(p.normalize()));
    try {
      return fn(...pointers);
    } finally {
      for (const p of pointers) module._free(p);
    }
  };

  return {
    mount(fileName, data) {
      const path = `${root}/${fileName}`;
      module.FS.writeFile(path, data, { encoding: "binary" });
      return path;
    },
    create(affPath, dicPath) {
      const handle = withStrings([affPath, dicPath], (aff, dic) => api.create(aff, dic));
      return {
        spell: (word) => withStrings([word], (w) => api.spell(handle, w)) !== 0,
        suggest: (word) => {
          const listPointer = module._malloc(POINTER_SIZE);
          try {
            const count = withStrings([word], (w) => api.suggest(handle, listPointer, w));
            const list = module.getValue(listPointer, "*");
            const suggestions: string[] = [];
            for (let i = 0; i < count; i++) {
              suggestions.push(module.UTF8ToString(module.getValue(list + i * POINTER_SIZE, "*")));
            }
            api.freeList(handle, listPointer, count);
            return suggestions;
          } finally {
            module._free(listPointer);
          }
        },
        addWord: (word) => {
          withStrings([word], (w) => api.add(handle, w));
        },
        removeWord: (word) => {
          withStrings([word], (w) => api.remove(handle, w));
        },
        dispose: () => {
          api.destroy(handle);
        },
      };
    },
  };
}
