/**
 * Higienização de entrada antes de sair do navegador. O servidor valida de
 * novo: isto é a camada de fora, não a única.
 */

export function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return str.replace(/[&<>"'/]/g, (char) => map[char] || char);
}

/**
 * Strips HTML tags from a string.
 */
export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

/**
 * Removes script tags and event handlers (onerror, onclick, etc).
 */
export function stripScripts(str: string): string {
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '');
}

/**
 * Full sanitization for user input: trims, strips scripts and HTML.
 * Use this for all text inputs (name, search, etc).
 */
export function sanitizeInput(str: string): string {
  if (!str) return '';
  return stripHtml(stripScripts(str.trim()));
}

/**
 * Sanitize email: trim, lowercase, validate length.
 */
export function sanitizeEmail(email: string): string {
  if (!email) return '';
  const sanitized = email.trim().toLowerCase();
  if (sanitized.length > 254) return sanitized.slice(0, 254);
  return sanitized;
}

/**
 * Validate input length within bounds.
 */
export function validateLength(str: string, min: number, max: number): boolean {
  const len = str.trim().length;
  return len >= min && len <= max;
}

/**
 * Sanitize an object's string values recursively.
 * Useful for sanitizing entire form data before submission.
 */
export function sanitizeFormData<T extends Record<string, unknown>>(data: T): T {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeFormData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized as T;
}
