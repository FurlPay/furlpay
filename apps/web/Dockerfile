# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# FurlPay web (Next.js standalone) — the image ECS/Fargate runs
# (infra/aws/modules/env/compute.tf). Build from the REPOSITORY ROOT:
#
#   docker build -f apps/web/Dockerfile -t furlpay-web:local .
#
# The context is the monorepo root because apps/web depends on @furlpay/*
# workspace packages and a single hoisted package-lock.json.
#
# NO SECRETS IN THIS IMAGE. Runtime secrets arrive as environment variables
# injected by the ECS execution role from Secrets Manager at task start.
# The only build-time inputs are the NEXT_PUBLIC_* values below, which Next.js
# inlines into the browser bundle — they are public by definition and must
# never be used for anything secret.
#
# Pin the base image by digest in CI (`--build-arg NODE_IMAGE=node:20-bookworm-slim@sha256:...`);
# a tag can move under you. Node 20 matches .github/workflows/ci.yml.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:20-bookworm-slim

# ── build ──────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true

# Public, build-time-inlined values. Defaults are empty: an unset value is a
# disabled integration in the bundle, never a leaked one.
ARG NEXT_PUBLIC_ALLOW_GUEST=""
ARG NEXT_PUBLIC_APPLE_CLIENT_ID=""
ARG NEXT_PUBLIC_APPLE_REDIRECT_URI=""
ARG NEXT_PUBLIC_BING_VERIFICATION=""
ARG NEXT_PUBLIC_GA4_ID=""
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ARG NEXT_PUBLIC_GSC_VERIFICATION=""
ARG NEXT_PUBLIC_HACKATHON_DEADLINE=""
ARG NEXT_PUBLIC_PERSONA_ENV=""
ARG NEXT_PUBLIC_PERSONA_TEMPLATE_ID=""
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""

# Everything not excluded by .dockerignore (which drops node_modules, build
# output, native/mobile apps, and every env/key file).
COPY . .

# Exactly the lockfile — `npm ci` refuses to drift from it.
RUN npm ci --no-audit --no-fund

# Workspace packages first (their dist/ is not in the context), then the web
# app itself with standalone output. The web build is run directly rather than
# through turbo because turbo's strict env mode would not pass NEXT_OUTPUT.
RUN npx turbo run build --filter="@furlpay/web^..." \
 && cd apps/web \
 && NEXT_OUTPUT=standalone npm run build

# ── runtime ────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Docker sets HOSTNAME to the container id; Next's standalone server binds
    # to $HOSTNAME, which would make it unreachable from the load balancer.
    HOSTNAME=0.0.0.0
WORKDIR /app

# The standalone tree mirrors the monorepo: server at apps/web/server.js,
# traced node_modules and workspace packages alongside it. Static assets and
# public/ are not part of the trace and are copied in explicitly.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

# uid 1000 = the `node` user in the official image; compute.tf runs 1000:1000
# with a read-only root filesystem, so /tmp and apps/web/.next/cache must be
# the only writable paths (mounted as volumes by the task definition).
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
