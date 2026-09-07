// Timestamps are RFC 3339 strings with milliseconds and the writer's UTC
// offset, e.g. `2026-09-07T09:31:05.123+02:00`. Display helpers read the
// wall-clock parts straight from the string, so a note written in another
// timezone keeps showing the local time of the place where it was written.

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The local time of `date` as an RFC 3339 string with the local offset. */
export function nowIso(date: Date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${offset}`
  );
}

/** `HH:MM:SS` as written. */
export function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

/** `YYYY-MM-DD` as written. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Mon 7 Sep 2026` for the calendar date written in the timestamp. */
export function formatDay(iso: string): string {
  const [y, m, d] = dayKey(iso).split("-").map(Number);
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 60_000;
}
