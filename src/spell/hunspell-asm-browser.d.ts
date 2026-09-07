// The Emscripten build of Hunspell shipped by hunspell-asm. It is a
// MODULARIZE'd CommonJS file; under Vite it arrives as a namespace whose
// `default` is the factory function.
declare module "hunspell-asm/dist/esm/lib/browser/hunspell.js" {
  const factory: (config: Record<string, unknown>) => unknown;
  export default factory;
}
