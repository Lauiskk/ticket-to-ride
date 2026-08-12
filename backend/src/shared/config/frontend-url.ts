/**
 * Where the API sends a browser back to after an OAuth round-trip.
 *
 * This cannot reuse `CORS_ORIGIN` verbatim any more: that variable is now a
 * comma-separated list with wildcards (production alias, preview deploys,
 * localhost), and redirecting to
 * `https://a.vercel.app,https://ticket-to-ride-*.vercel.app,http://localhost:5173`
 * sends the user nowhere.
 *
 * `FRONTEND_URL` wins when set. Otherwise we take the first entry of
 * `CORS_ORIGIN` that is a concrete origin — a wildcard is a matching rule, not
 * an address you can navigate to.
 */
export function resolveFrontendUrl(
  frontendUrl?: string,
  corsOrigin?: string,
): string {
  if (frontendUrl?.trim()) return stripTrailingSlash(frontendUrl.trim());

  const concrete = (corsOrigin ?? '')
    .split(',')
    .map((o) => o.trim())
    .find((o) => o && !o.includes('*'));

  return stripTrailingSlash(concrete || 'http://localhost:5173');
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
