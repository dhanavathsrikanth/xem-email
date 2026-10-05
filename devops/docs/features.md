# Xem feature services on Coolify

The dashboard uses `https://app.goclaim.space`; the backend uses
`https://api.goclaim.space`. Coolify runs on `https://coolify.goclaim.space`.
These services run on AWS independently of the operator's laptop.

## Credentials and service configuration

Keep real values in Coolify's runtime environment. The private local copies are
`devops/.env.coolify-server.local` and `devops/.env.coolify-client.local` and are
ignored by Git. Google sign-in credentials also live in `client/.env.local`.
Never mark provider keys, OAuth secrets or Redis URLs as build-time variables or
prefix them with `NEXT_PUBLIC_`.

Google OAuth is a Web application client with JavaScript origin
`https://app.goclaim.space` and redirect URI
`https://app.goclaim.space/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` on the dashboard. `NEXTAUTH_URL` must use the production
dashboard origin. This OAuth client is separate from the Gemini API key and
from optional Gmail mailbox access. If the Google consent screen is in testing,
the operator must add the intended Google accounts as test users.

The backend AI gateway uses `AI_GATEWAY_ENABLED=true`, a random
`AI_GATEWAY_SECRET` of at least 32 characters, and `AI_PRIMARY_*` and
`AI_FALLBACK_*` endpoint, key and model values. The primary endpoint is
`https://generativelanguage.googleapis.com/v1beta/openai`, model
`gemini-3.8-flash`. The fallback endpoint is `https://tokenharbor.ai/v1`, model
`deepseek-v4.1-flash:free`. Provider catalogs and quotas can change; neither free
availability nor a successful fallback is guaranteed when both accounts have
exhausted their quotas.

Both backend and dashboard use `AI_PROXY_BASE_URL=https://api.goclaim.space/internal/ai`
and `AI_PROXY_API_KEY` equal to the shared gateway secret. The backend additionally
uses `AI_ENABLED=true`, `AI_PROVIDER=openai-compatible` and
`AI_MODEL=gemini-3.8-flash`. The dashboard uses
`AI_PROXY_MODEL=gemini-3.8-flash`, `XEM_ASSISTANT_ENABLED=true` and
`ASSISTANT_REDIS_URL` equal to its TLS Redis connection URL.

The gateway retries on a network failure, HTTP 429 or HTTP 5xx only before it has
forwarded any response. It does not repeat a tool action after partial output.

## Workspace tools service

Create a separate Coolify Compose application from the same Git repository,
base directory `/`, compose location `/devops/coolify-tools.yml`. Preserve the
repository during deployment so the service build context is present. No public
domain or host port is needed. The service joins the external `coolify` Docker
network with DNS alias `xem-mcp`.

Set backend `MCP_INTERNAL_URL=http://xem-mcp:3000` and dashboard
`XEM_MCP_URL=https://api.goclaim.space/mcp`. The API proxies that route to the
private service and preserves each user's scoped authorization. The tools server
does not receive a global workspace API key. Its `/health` check is internal.

## Feature verification and limits

Use a disposable workspace to check login, CRM, templates, public form capture,
workflow execution, storage and AI. A page returning HTTP 200 alone is not enough
to verify background work: inspect the execution's final state. PostgreSQL UUID
columns require a real starting node ID when a workflow execution is created.

Email delivery remains disabled through the managed sending and account notice
flags. SMTP, Gmail inbox sync, campaign delivery and email-based password resets
are outside this deployment's verification scope. Email reports remain empty
until actual delivery events exist.

Billing now reads the actual product catalog and workspace subscription from the
backend through authenticated `GET /api/billing`. An absent subscription is an
empty state; database errors and 15-second timeouts produce a retryable error,
not an endless spinner. Deleted products are excluded. The legacy client called
missing routes and expected an unrelated payment service's data format.
The startup migration includes products, product feature configurations and
subscriptions. This migration was tested on a one-day Neon branch copied from
production: both billing reads succeeded and existing user, team and contact
counts were preserved. Production uses the direct PostgreSQL endpoint.

The page is currently read-only. Paid checkout, payment history and cancellation
must not be advertised as functional: the provider credentials are absent and
the existing Dodo webhook signature verifier is unfinished. A future payment
integration needs verified webhooks and end-to-end payment tests before enabling
checkout; adding an API key alone is insufficient.

Completed deployment checks used one isolated synthetic workspace: 31 API/page
reads, CRM contact/stage/note/tag changes, template preview/versioning, public
form capture, R2 upload/download, a Redis worker workflow reaching COMPLETED,
assistant streaming with a scoped workspace tool and Redis persistence, and
Gemini form, analytics and workflow proposal generation. No email was sent.
Google OAuth initiation used the correct production client and callback; a real
Google account consent/login remains a user test. TokenHarbor's free quota was
exhausted during verification, so the fallback cannot currently guarantee service.

AI campaign analytics and automation optimization verify the authenticated
workspace's ownership before any context read or model request.

After runtime environment edits, restart the dashboard to apply them. Backend
source changes require a backend deploy. Build one application at a time on the
2 GB AWS instance; keep the existing frontend Dockerfile's Node heap limit and
the server's swap configuration.
