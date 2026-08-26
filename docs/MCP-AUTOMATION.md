# MCP automation service

The MCP endpoint lets Codex, Claude Code, ChatGPT plugins, and Claude's API
connector operate the icon generator without clicking through the React UI.
It uses the same Replicate account and model/cost policy, but stores every job
and item outside the browser.

## What ships

- Stateless Streamable HTTP MCP at `POST /api/mcp` (and `/mcp` through the
  deployment rewrite).
- Signed, expiring plans. Planning never starts paid work.
- Explicit maximum-cost approval and idempotency keys before generation.
- Persistent job and per-icon state in Supabase.
- A bounded queue (maximum concurrency 3) advanced by Replicate completion
  webhooks rather than by an open browser tab.
- Structured errors, selective retry, cancellation, long polling, and a JSON
  export manifest.
- Durable output copies in the public `icon-automation` Storage bucket.

Transparent mode currently returns isolated glyph PNG assets. Complete mode
returns the model's finished opaque icon. Browser-side deterministic container
composition remains the authoritative route for geometry-locked final exports;
the automation manifest records the output mode so a downstream importer never
mistakes a glyph layer for a finished icon.

## Configure

Run `supabase/migrations/20260825000000_icon_automation.sql`, then set:

```dotenv
REPLICATE_API_TOKEN=r8_...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ICON_AUTOMATION_SECRET=a-long-random-secret
ICON_MCP_BEARER_TOKEN=another-long-random-secret
PUBLIC_BASE_URL=https://your-deployment.example
ICON_AUTOMATION_BUCKET=icon-automation
```

`SUPABASE_SERVICE_ROLE_KEY` and both secrets are server-only. Never expose them
through Vite variables or MCP tool arguments. `ICON_MCP_BEARER_TOKEN` is the
single-user/private-beta authentication mechanism; replace it with OAuth before
giving unrelated customers access.

Memory persistence is available for tests and local inspection only. A
production deployment refuses to be considered durable without Supabase.

## Connect Codex

```toml
[mcp_servers.front_icon]
url = "https://your-deployment.example/mcp"
bearer_token_env_var = "ICON_MCP_BEARER_TOKEN"
tool_timeout_sec = 55
required = true
```

Or add it from the CLI:

```bash
codex mcp add front_icon --url https://your-deployment.example/mcp
```

## Connect Claude Code

```bash
claude mcp add --transport http --scope user front-icon \
  https://your-deployment.example/mcp \
  --header "Authorization: Bearer $ICON_MCP_BEARER_TOKEN"
```

## Safe agent workflow

1. `icons_get_capabilities`
2. `icons_plan_family`
3. Show the exact estimate and obtain approval.
4. `icons_start_family` with the returned token, approved maximum, and a stable
   idempotency key.
5. `icons_wait_for_job`; use its `updated_at` as `after_updated_at` on the next
   wait.
6. If partial or failed, call `icons_list_job_errors`, then
   `icons_retry_items` only for retryable items.
7. `icons_export_manifest`

## Operational notes

- Replicate must be able to reach `PUBLIC_BASE_URL/api/automation-webhook`.
  Local paid runs therefore need a secure tunnel or a deployed URL.
- Webhook tokens are signed and bound to one job item. Duplicate terminal
  webhooks are accepted idempotently.
- Provider output is copied to Supabase Storage as soon as the completion
  webhook arrives.
- The SQL claim function uses `FOR UPDATE SKIP LOCKED`, so simultaneous webhook
  invocations cannot claim the same queued item.
