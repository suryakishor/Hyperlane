import { USERNAME } from '../core/GameConfig';

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'tooLong' | 'invalid'; message: string };

/** Control characters and zero-width marks are never valid in a callsign. */
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/;

/**
 * Normalises raw input into a safe callsign.
 *
 * The value is only ever held in memory for the current session and rendered as
 * text, so validation focuses on trimming, length and characters that would
 * break the UI.
 */
export function validateUsername(raw: string): UsernameValidation {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return { ok: false, reason: 'empty', message: 'Enter a callsign to start running.' };
  }
  if (FORBIDDEN.test(collapsed)) {
    return { ok: false, reason: 'invalid', message: 'Callsign contains unsupported characters.' };
  }
  if (collapsed.length > USERNAME.maxLength) {
    return {
      ok: false,
      reason: 'tooLong',
      message: `Callsign must be ${USERNAME.maxLength} characters or fewer.`,
    };
  }
  return { ok: true, value: collapsed };
}

/** Returns a valid callsign or null when the input cannot be normalised. */
export function normaliseUsername(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const result = validateUsername(raw);
  return result.ok ? result.value : null;
}
