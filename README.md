# @linimin/pi-headroom

A pi extension that routes supported pi providers through local Headroom proxies.

## Quickstart

```bash
# 1) Install Headroom first
curl -fsSL https://raw.githubusercontent.com/chopratejas/headroom/main/scripts/install.sh | bash

# 2) Install this pi package
pi install npm:@linimin/pi-headroom
```

Then open pi and run:

```text
/reload
/model
/headroom-status
```

## What this extension does

When you choose a supported provider in pi, the extension:

- overrides that provider's `baseUrl` to a local Headroom proxy,
- expects one canonical local port per provider,
- does **not** automatically start, stop, or restart proxies for you,
- does **not** attach to arbitrary fallback ports,
- shows proxy status in the pi footer,
- shows expected ports, URLs, and routing details in `/headroom-status`.

The goal is simple: you manage Headroom yourself, and this package cleanly attaches pi to the expected local proxy.

## Lifecycle model

`pi-headroom` is **attach-only**.

That means:

- you decide whether a proxy should be running,
- you can start Headroom yourself or use the explicit helper command `/headroom-start`,
- you stop Headroom yourself,
- this extension only checks whether the expected proxy is available and routes pi to it.

If the proxy is not running, the extension tells you which port and URL are expected.

## Prerequisite

You must install **Headroom** first. This package does **not** install Headroom for you. It expects the `headroom` CLI to be available on `PATH` if you want to start proxies with the CLI yourself.

If Headroom is missing or your proxy is not running, the extension will:

- warn clearly,
- leave pi otherwise usable,
- tell you which provider port should be started.

## Install

### 1. Install Headroom

See the official Headroom install docs for your platform. Typical examples:

#### macOS

```bash
curl -fsSL https://raw.githubusercontent.com/chopratejas/headroom/main/scripts/install.sh | "$(brew --prefix bash)/bin/bash"
```

#### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/chopratejas/headroom/main/scripts/install.sh | bash
```

#### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/chopratejas/headroom/main/scripts/install.ps1 | iex
```

### 2. Install the pi package

```bash
pi install npm:@linimin/pi-headroom
```

If pi is already running, reload extensions:

```text
/reload
```

A sample `docker-compose.yml` is included in this package root if you want to run Headroom proxies with Docker. A matching `.env.example` is also included for upstream override values.

### 3. Optional: configure Docker env overrides

```bash
cp .env.example .env
```

Then edit `.env` if you want to point a provider at a different upstream.

For `github-copilot` in Docker, prefer setting an explicit `GITHUB_COPILOT_TOKEN` or `GITHUB_COPILOT_GITHUB_TOKEN` in `.env`. Docker containers generally cannot reuse your host keychain/session auth the same way local host processes can.

For `github-copilot` on Business seats, prefer starting the proxy through `/headroom-start github-copilot` or otherwise ensure the proxy process has a current `GITHUB_COPILOT_API_TOKEN`.

By default, `pi-headroom` does **not** scrape `~/.pi/agent/auth.json` and reuse Pi's local Copilot access token for the proxy process. If no explicit `GITHUB_COPILOT_API_TOKEN` is set, it now defaults back to Headroom token exchange.

If you explicitly want to reuse Pi's local Copilot access token for Headroom, opt in with:

```bash
export PI_HEADROOM_COPILOT_REUSE_PI_ACCESS_TOKEN=1
```

This opt-in path can still behave differently from Pi's direct built-in OAuth flow, so if a model works without Headroom but fails through Headroom, first try leaving this opt-in disabled.

## Enable / use

1. Open pi.
2. Select a supported provider/model with `/model`.
3. If you want traffic to go through Headroom, make sure the matching proxy is running on its expected local port.
4. Start using the model normally.

If the proxy is not running, pi-headroom falls back to the provider default and tells you what to start if you want Headroom attached.

## Quick verification

Inside pi:

```text
/headroom-status
```

You should see:

- the current managed provider,
- the expected local proxy root URL,
- the expected routed base URL,
- the dashboard URL,
- whether the proxy is currently reachable,
- whether pi is currently attached to Headroom or falling back to the provider default.

## Supported providers

### OpenAI-style, routed through `/v1`

- `xai`
- `github-copilot`
- `openai`
- `openrouter`
- `deepseek`
- `groq`
- `together`
- `cerebras`
- `nvidia`
- `huggingface`
- `ant-ling`
- `moonshotai`
- `moonshotai-cn`
- `xiaomi`
- `xiaomi-token-plan-cn`
- `xiaomi-token-plan-ams`
- `xiaomi-token-plan-sgp`

### Anthropic-style, routed through the root URL

- `anthropic`
- `fireworks`
- `minimax`
- `minimax-cn`
- `kimi-coding`
- `mistral`

### Gemini / Vertex

- `google`
- `google-vertex`

## Default local ports

Each provider has one canonical expected local port. If you override a provider port with environment variables, pi-headroom will expect that overridden port instead.

Default ports:

- `xai` → `8787`
- `github-copilot` → `8788`
- `openai` → `8789`
- `anthropic` → `8790`
- `openrouter` → `8791`
- `deepseek` → `8792`
- `groq` → `8793`
- `together` → `8794`
- `mistral` → `8795`
- `fireworks` → `8796`
- `google` → `8797`
- `google-vertex` → `8798`
- `cerebras` → `8799`
- `nvidia` → `8800`
- `huggingface` → `8801`
- `ant-ling` → `8802`
- `moonshotai` → `8803`
- `moonshotai-cn` → `8804`
- `minimax` → `8805`
- `minimax-cn` → `8806`
- `xiaomi` → `8807`
- `xiaomi-token-plan-cn` → `8808`
- `xiaomi-token-plan-ams` → `8809`
- `xiaomi-token-plan-sgp` → `8810`
- `kimi-coding` → `8811`

## Commands

### `/headroom-status [provider|all]`

If no provider is passed, it defaults to the provider of the currently selected model.

Shows:

- the current provider,
- the current model base URL,
- the expected local proxy root URL,
- the expected routed base URL,
- the dashboard URL,
- observed running/unavailable status.

This is the main diagnostic command in attach-only mode.

### `/headroom-start [provider|all]`

Start Headroom on the canonical configured port for that provider.

If no provider is passed, it defaults to the provider of the currently selected model.

This command:

- only uses the provider's configured port,
- does not choose fallback ports,
- reports an error if the canonical port is occupied,
- leaves stop/restart decisions to you.

## Footer status

The extension shows a lightweight status line in pi, for example:

```text
Headroom:openai running | hist saved 33.0M | $83.3 | 36%
```

If the expected proxy is not running, you will see something like:

```text
Headroom:github-copilot unavailable | /headroom-start github-copilot
```

## Important behavior

- **Supported providers** are routed through Headroom.
- **Unsupported providers** fall back to normal pi behavior.
- The extension does not automatically manage proxy lifecycle.
- There is no automatic stop, restart, recovery, or fallback-port migration.
- `/headroom-start` is an explicit user-triggered helper, not background lifecycle management.
- One provider maps to one expected local proxy port.
- If the expected proxy is unavailable, the extension falls back to the provider default and tells you what should be running and where.
- Footer perf numbers prefer Headroom Historical Proxy Compression data (`/stats-history` lifetime stats, with `/stats` fallback).
- GitHub Copilot keeps pi's built-in OAuth flow and re-routes the final base URL through Headroom.
- For GitHub Copilot, explicit `GITHUB_COPILOT_API_TOKEN` takes priority. Without it, the default is Headroom token exchange unless you explicitly opt in to reusing Pi's local access token via `PI_HEADROOM_COPILOT_REUSE_PI_ACCESS_TOKEN=1`.

## Useful environment

Common ones:

- `PI_HEADROOM_BIN`
- `PI_HEADROOM_HOST`
- `PI_HEADROOM_VERBOSE`
- `PI_HEADROOM_PROBE_TIMEOUT_MS`
- `PI_HEADROOM_HEALTH_TTL_MS`

Each provider also has optional port/upstream overrides such as:

- `PI_HEADROOM_OPENAI_PORT`
- `PI_HEADROOM_OPENAI_UPSTREAM`
- `PI_HEADROOM_ANTHROPIC_PORT`
- `PI_HEADROOM_ANTHROPIC_UPSTREAM`
- `PI_HEADROOM_OPENROUTER_PORT`
- `PI_HEADROOM_OPENROUTER_UPSTREAM`
- etc.

## Not covered yet

These pi providers still need more provider-specific handling and are not yet managed by this extension:

- `amazon-bedrock`
- `azure-openai-responses`
- `cloudflare-ai-gateway`
- `cloudflare-workers-ai`
- `vercel-ai-gateway`
- `openai-codex`
- `opencode`
- `opencode-go`
- `zai`
- `zai-coding-cn`

## Package development

Local source layout:

- `index.ts` — main attach-only supervisor logic
- `provider-registry.ts` — provider registry and routing specs

Install locally during development:

```bash
pi install /absolute/path/to/pi-headroom
```
