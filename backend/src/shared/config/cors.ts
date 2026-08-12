/**
 * Turn `CORS_ORIGIN` into something `enableCors` can use.
 *
 * Accepts a comma-separated list, and `*` inside an entry becomes a wildcard.
 * A single origin was not enough in practice: the frontend lives on a Vercel
 * production alias, every preview deploy gets its own hostname, and local dev
 * runs on localhost — all three are legitimate callers of the same API. The
 * first production deploy failed exactly here, answering
 * `access-control-allow-origin: http://localhost:5173` to a browser on
 * ticket-to-ride-psi.vercel.app.
 *
 * Wildcards match hostname characters only and the scheme is compared
 * literally, so `https://*.vercel.app` cannot be satisfied by `http://`, by a
 * different domain, or by a suffix glued on the end.
 *
 * Lives in its own file so it can be unit tested without importing `main.ts`,
 * which would pull in the entire application module graph.
 */
export function parseCorsOrigins(raw: string): Array<string | RegExp> {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!entry.includes('*')) return entry;

      const pattern = entry
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex metachars
        .replace(/\*/g, '[a-z0-9-]+'); // wildcard = hostname chunk

      return new RegExp(`^${pattern}$`, 'i');
    });
}
