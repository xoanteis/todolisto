// Mirror of `extract_tags` in the Rust core; the backend recomputes tags on
// every save, this copy only serves the in-browser backend and the UI.

const isTagChar = (c: string) => /[\p{L}\p{N}_\-:/.]/u.test(c);

export function extractTags(text: string): string[] {
  const chars = Array.from(text);
  const tags: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const starts =
      chars[i] === "#" &&
      (i === 0 || !isTagChar(chars[i - 1])) &&
      i + 1 < chars.length &&
      /\p{L}/u.test(chars[i + 1]);
    if (!starts) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < chars.length && isTagChar(chars[j])) j += 1;
    let end = j;
    while (end > i + 1 && ".:-/".includes(chars[end - 1])) end -= 1;
    const tag = chars.slice(i + 1, end).join("").toLowerCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
    i = j;
  }
  return tags;
}
