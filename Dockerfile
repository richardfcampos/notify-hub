# Multi-stage build: compile TypeScript in a build stage, ship only
# production node_modules + compiled dist in the runtime stage. Same image
# serves both api and worker; docker-compose.yml sets the command per
# service (spec NOTIF-12).

FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# No CMD baked in: docker-compose.yml sets `command:` per service
# (node dist/bin/api.js or node dist/bin/worker.js). Default to api so the
# image is still runnable standalone (`docker run <image>`).
CMD ["node", "dist/bin/api.js"]
