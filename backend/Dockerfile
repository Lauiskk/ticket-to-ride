# ─── Build ────────────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# Copy the lock file too. Building from package.json alone meant `npm install`
# silently resolved whatever was newest — and hid the fact that the lock file
# had drifted out of sync (passport-google-oauth20 was in package.json but not
# in the lock, which only surfaced when CI ran `npm ci`).
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY --from=build /app/dist ./dist

# Don't run the API as root
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
