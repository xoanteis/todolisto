// ULIDs: 10 characters of millisecond time plus 16 random characters, in
// Crockford base32. They sort by creation time and need no coordination,
// which is what a multi-PC note stream wants.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now: number = Date.now()): string {
  let time = now;
  let head = "";
  for (let i = 0; i < 10; i++) {
    head = ENCODING[time % 32] + head;
    time = Math.floor(time / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let tail = "";
  for (let i = 0; i < 16; i++) {
    tail += ENCODING[bytes[i] % 32];
  }
  return head + tail;
}
