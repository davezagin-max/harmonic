/**
 * Camelot wheel colours. Each wheel position owns a hue, 30 degrees apart, in
 * the order the printed wheel uses (teal at 1, through green, yellow, orange,
 * pink and purple, back to cyan at 12). Lightness and chroma come from CSS
 * variables, so the same hue works in the dark and light themes.
 */
import type { CamelotKey } from "../music/camelot";

export function keyHue(position: number): number {
  return (((180 - 30 * (position - 1)) % 360) + 360) % 360;
}

/** Solid colour for nodes, bars, and chips. */
export function keyColor(key: CamelotKey): string {
  return `oklch(var(--key-l) var(--key-c) ${keyHue(key.n)})`;
}

/** Quiet tint for the wheel segments and chip backgrounds. */
export function keySoft(key: CamelotKey): string {
  return `oklch(var(--key-soft-l) var(--key-soft-c) ${keyHue(key.n)})`;
}

/** Brighter tint for a segment that is lit as a compatible move. */
export function keyLit(key: CamelotKey): string {
  return `oklch(var(--key-lit-l) var(--key-lit-c) ${keyHue(key.n)})`;
}

/** Readable text in the key's hue, for labels that sit on a tinted segment. */
export function keyText(key: CamelotKey): string {
  return `oklch(var(--key-text-l) var(--key-c) ${keyHue(key.n)})`;
}
