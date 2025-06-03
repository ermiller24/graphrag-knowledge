FROM node:23-bookworm AS builder

COPY / /app
COPY tsconfig.json /tsconfig.json

WORKDIR /app

RUN --mount=type=cache,target=/root/.npm npm install

RUN --mount=type=cache,target=/root/.npm-production npm ci --ignore-scripts --omit-dev

FROM node:23-bookworm AS release


COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json
COPY --from=builder /app/scripts /app/scripts

ENV NODE_ENV=production

RUN apt update
RUN apt install -y openssh-server

WORKDIR /app


RUN npm ci --ignore-scripts --omit-dev

ENTRYPOINT ["node", "dist/index.js"]