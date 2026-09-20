import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Whether a string holds a character the backend refuses in a config value.
 *
 * Mirrors `_UNSAFE_TEXT` in backend/integrations/config.py plus its separate
 * newline check: every C0 control except tab, the DEL character, and CR/LF.
 * Written with char codes rather than a regex so the literal control
 * characters never have to appear in source.
 */
export function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x7f) return true;
    if (code < 0x20 && code !== 0x09) return true;
  }
  return false;
}
