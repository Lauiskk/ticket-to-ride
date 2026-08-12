import * as Joi from 'joi';

/**
 * Joi validation schema for environment variables.
 * Required vars will cause the app to fail fast at startup if missing.
 * Optional vars have sensible defaults documented here.
 *
 * IMPORTANT: Never log environment variable VALUES — only reference by key name.
 */
export const envValidationSchema = Joi.object({
  // ─── Required ───────────────────────────────────────────────────────
  DATABASE_URL: Joi.string().uri().required().description(
    'PostgreSQL connection string (e.g. postgres://user:pass@localhost:5432/ticketdb)',
  ),
  JWT_SECRET: Joi.string().min(32).required().description(
    'Secret key for signing JWT access tokens (min 32 chars)',
  ),
  TICKET_SIGNING_SECRET: Joi.string().min(32).required().description(
    'HMAC-SHA256 secret for signing ticket QR code payloads (min 32 chars)',
  ),
  REDIS_URL: Joi.string().uri().required().description(
    'Redis connection URL (e.g. redis://localhost:6379)',
  ),
  TICKETMASTER_API_KEY: Joi.string().required().description(
    'Ticketmaster Discovery API key',
  ),
  STRIPE_SECRET_KEY: Joi.string().required().description(
    'Stripe secret key (use test mode key: sk_test_...)',
  ),
  STRIPE_WEBHOOK_SECRET: Joi.string().required().description(
    'Stripe webhook endpoint signing secret (whsec_...)',
  ),

  // ─── Optional (with defaults) ──────────────────────────────────────
  PORT: Joi.number().default(3000).description(
    'Port the API listens on',
  ),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development')
    .description('Application environment'),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173').description(
    'Allowed CORS origin (frontend URL)',
  ),
  TMDB_API_KEY: Joi.string().optional().default('').description(
    'TMDb API key (optional — Ticketmaster is primary)',
  ),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d').description(
    'Refresh token expiry duration',
  ),
  JWT_ACCESS_EXPIRY: Joi.string().default('15m').description(
    'Access token expiry duration',
  ),
  RESERVATION_TTL_MINUTES: Joi.number().default(10).description(
    'Minutes before an unpaid reservation expires',
  ),
  SHARING_LINK_TTL_HOURS: Joi.number().default(48).description(
    'Hours before a sharing link expires',
  ),
});

/**
 * Configuration factory — returns a typed config object from validated env vars.
 * Consumed via ConfigService.get<T>('key').
 */
export const configuration = () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  ticket: {
    signingSecret: process.env.TICKET_SIGNING_SECRET,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },

  externalApis: {
    ticketmasterApiKey: process.env.TICKETMASTER_API_KEY,
    tmdbApiKey: process.env.TMDB_API_KEY || '',
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  reservation: {
    ttlMinutes: parseInt(process.env.RESERVATION_TTL_MINUTES || '10', 10),
  },

  sharing: {
    ttlHours: parseInt(process.env.SHARING_LINK_TTL_HOURS || '48', 10),
  },
});
