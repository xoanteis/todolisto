#!/usr/bin/env node
// Fails when a built-in autocorrect key is accepted by any bundled dictionary
// (it would then fight the spell checker) or when a replacement is not.
const fs = require("fs");
const path = require("path");
const { loadModule } = require("hunspell-asm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/spell/autocorrect.ts"), "utf8");
const start = source.indexOf("BUILTIN_RULES");
const block = source.slice(start, source.indexOf("};", start));
const rules = [...block.matchAll(/^\s*([\p{L}]+):\s*"([^"]+)"/gmu)].map((m) => [m[1], m[2]]);

(async () => {
  const factory = await loadModule();
  const dictDir = path.join(root, "public/dict");
  const dictionaries = ["en_US", "es_ES", "gl_ES"].map((stem) => [
    stem,
    factory.create(
      factory.mountBuffer(fs.readFileSync(path.join(dictDir, `${stem}.aff`)), `${stem}.aff`),
      factory.mountBuffer(fs.readFileSync(path.join(dictDir, `${stem}.dic`)), `${stem}.dic`),
    ),
  ]);
  let problems = 0;
  for (const [wrong, right] of rules) {
    const accepts = dictionaries.filter(([, h]) => h.spell(wrong)).map(([stem]) => stem);
    const rightKnown = right.split(" ").every((w) => dictionaries.some(([, h]) => h.spell(w)));
    if (accepts.length > 0 || !rightKnown || wrong === right) {
      problems += 1;
      console.log(`problem: ${wrong} -> ${right} (accepted by ${accepts.join(",") || "nobody"}; replacement known: ${rightKnown})`);
    }
  }
  console.log(`${rules.length} built-in rules checked, ${problems} problem(s)`);
  process.exit(problems ? 1 : 0);
})();
