# syntax=docker/dockerfile:1.7

# Keep Deno available without depending on an install script at container startup.
FROM denoland/deno:bin-2.5.6 AS deno-bin

# Include the Supabase CLI so migrations/functions can be exercised from the same dev container.
FROM supabase/cli:latest AS supabase-cli

FROM node:24.15.0-bookworm

ARG PNPM_VERSION=10.28.1

ENV PNPM_HOME=/home/node/.local/share/pnpm \
    DENO_DIR=/home/node/.cache/deno \
    PATH=/home/node/.local/share/pnpm:/home/node/.deno/bin:/usr/local/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      jq \
      openssl \
      postgresql-client \
      unzip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deno-bin /deno /usr/local/bin/deno
COPY --from=supabase-cli /usr/local/bin/supabase /usr/local/bin/supabase

RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && mkdir -p "$PNPM_HOME" "$DENO_DIR" \
    && chown -R node:node /home/node

USER node
WORKDIR /workspace/PennTrain

CMD ["bash"]
