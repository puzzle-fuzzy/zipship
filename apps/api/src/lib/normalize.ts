/**
 * Shared input-normalization helpers. Keep user-input shaping in one place so
 * validation rules can't drift between modules.
 */

/** Trim a free-form name/description; return `null` if empty after trimming. */
export function normalizeName(name: string): string | null {
  const normalized = name.trim();
  return normalized.length > 0 ? normalized : null;
}

/** Lowercase + shape-check an email; return `null` if it isn't well-formed. */
export function normalizeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}
