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
- starts the proxy automatically if it is not already running,
- runs one shared managed proxy per provider across pi sessions and agent processes,
- does not attach to arbitrary external Headroom proxies,
- shows proxy status in the pi footer,
- shows dashboard URLs and routing details in `/headroom-status`.

The goal is simple: install Headroom, install this pi package, then use supported providers in pi without manually starting proxies.

## Prerequisite

You must install **Headroom** first. This package does **not** install Headroom for you. It expects the `headroom` CLI to be available on `PATH`.

If Headroom is missing, the extension will:

- warn clearly,
- leave pi usable,
- let unmanaged/default pi provider behavior continue.

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

## Enable / use

1. Open pi.
2. Select a supported provider/model with `/model`.
3. Start using the model normally.

The extension will auto-start the matching local Headroom proxy when needed.

## Quick verification

Inside pi:

```text
/headroom-status
```

You should see:

- the current managed provider,
- the current routed local base URL,
- the active dashboard URL,
- the managed provider proxy state.

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

Preferred ports with fallback scanning:

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

### `/headroom-status`

Shows:

- current provider,
- current model base URL,
- active dashboard URL,
- proxy map,
- managed/unmanaged behavior hints.

### `/headroom-stop [provider|all]`

Stop managed Headroom provider proxies.

### `/headroom-restart [provider|all]`

Restart managed Headroom provider proxies.

## Footer status

The extension shows a lightweight status line in pi, for example:

```text
Headroom:openai running | hist saved 33.0M | $83.3 | 36%
```

## Important behavior

- **Supported providers** are routed through Headroom.
- **Unsupported providers** fall back to normal pi behavior.
- If Headroom is missing, the extension warns and does **not** block normal pi usage.
- By default, each provider uses one shared managed proxy that stays available across pi sessions and agent processes.
- Proxy startup is serialized across processes so one provider converges on one managed proxy.
- If a managed provider proxy becomes unhealthy, the extension automatically stops and restarts it on demand.
- Footer perf numbers prefer Headroom Historical Proxy Compression data (`/stats-history` lifetime stats, with `/stats` fallback), so they survive proxy restarts better than per-process runtime counters.
- GitHub Copilot keeps pi's built-in OAuth flow and re-routes the final base URL through Headroom.

## Useful environment

Common ones:

- `PI_HEADROOM_BIN`
- `PI_HEADROOM_HOST`
- `PI_HEADROOM_AUTOSTART`
- `PI_HEADROOM_VERBOSE`
- `PI_HEADROOM_PORT_SCAN_LIMIT`
- `PI_HEADROOM_STATE_DIR`
- `PI_HEADROOM_START_LOCK_WAIT_MS`
- `PI_HEADROOM_START_LOCK_STALE_MS`

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

- `index.ts` — main supervisor logic
- `provider-registry.ts` — provider registry and routing specs

Install locally during development:

```bash
pi install /absolute/path/to/pi-headroom
```
