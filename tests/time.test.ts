import { describe, expect, it } from "vitest";

import { dayKey, formatDay, minutesBetween, nowIso, timeOf } from "../src/model/time";

describe("time", () => {
  it("formats local time as RFC 3339 with milliseconds and offset", () => {
    const iso = nowIso(new Date(2026, 8, 7, 9, 31, 5, 123));
    expect(iso).toMatch(/^2026-09-07T09:31:05\.123[+-]\d\d:\d\d$/);
    expect(Date.parse(iso)).toBe(new Date(2026, 8, 7, 9, 31, 5, 123).getTime());
  });

  it("reads the wall clock parts as written", () => {
    const iso = "2026-09-07T09:31:05.123+02:00";
    expect(timeOf(iso)).toBe("09:31:05");
    expect(dayKey(iso)).toBe("2026-09-07");
    expect(formatDay(iso)).toBe("Mon 7 Sep 2026");
    expect(formatDay("2027-01-01T00:00:00.000-05:00")).toBe("Fri 1 Jan 2027");
  });

  it("measures minutes across offsets", () => {
    expect(minutesBetween("2026-09-07T09:00:00.000+02:00", "2026-09-07T08:30:00.000+01:00")).toBe(30);
  });
});
