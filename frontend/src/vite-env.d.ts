/// <reference types="vite/client" />

/**
 * Build-time configuration injected by Vite.
 *
 * Everything here is bundled into the JS the browser downloads — public by
 * construction. Secrets (Stripe secret key, JWT signing key, API keys) live in
 * `backend/.env` and never cross this boundary.
 */
interface ImportMetaEnv {
  /** API origin. Empty in dev so the Vite proxy handles `/api`. */
  readonly VITE_API_URL?: string;
  /** Origin of the seat-availability WebSocket (namespace `/seats`). */
  readonly VITE_WS_URL?: string;
  /** Stripe publishable key (`pk_test_…`). Absent → checkout falls back to simulated mode. */
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
