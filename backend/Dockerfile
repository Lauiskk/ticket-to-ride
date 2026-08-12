FROM node:20-slim AS base
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:20-slim AS production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps && npm install bcryptjs --legacy-peer-deps
COPY --from=base /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
