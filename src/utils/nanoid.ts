/** Tiny unique id — no dependency needed */
export function nanoid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
