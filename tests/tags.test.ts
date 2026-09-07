import { describe, expect, it } from "vitest";

import { extractTags } from "../src/model/tags";
import { ulid } from "../src/model/ulid";

describe("tags", () => {
  it("matches the Rust extractor", () => {
    expect(extractTags("#TODO ask Maria #q about #todo")).toEqual(["todo", "q"]);
    expect(extractTags("see #repo:owner/name.")).toEqual(["repo:owner/name"]);
    expect(extractTags("http://x.y/z#frag and a#b")).toEqual([]);
    expect(extractTags("#1 issue ## nothing")).toEqual([]);
    expect(extractTags("(#idea) #dec-1!")).toEqual(["idea", "dec-1"]);
    expect(extractTags("#España #galego")).toEqual(["españa", "galego"]);
  });
});

describe("ulid", () => {
  it("is 26 Crockford characters and sorts by time", () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
    expect(ulid()).not.toBe(ulid());
  });
});
