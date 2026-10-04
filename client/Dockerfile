FROM oven/bun:1.3.5-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_PAYWALL_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_PAYWALL_URL=$NEXT_PUBLIC_PAYWALL_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
# Next's TypeScript worker needs Node; Bun's heap is not limited by NODE_OPTIONS.
RUN apk add --no-cache nodejs
COPY . .
# Bound Node's build heap so compilation cannot consume the small host's RAM and swap.
# This applies only to the build stage; the runtime image keeps its normal settings.
RUN NODE_OPTIONS=--max-old-space-size=1536 node node_modules/next/dist/bin/next build --turbopack

# Ship only the standalone application, with no source tree, credentials or build tools.
FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static
COPY --from=builder --chown=bun:bun /app/public ./public
USER bun
EXPOSE 3000
CMD ["bun", "server.js"]
