import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  buildManagedProxyConfig,
  managedProviderFor,
  preferredPortFor,
  providerIds,
  registerManagedProvider,
  type ManagedProvider,
  type ManagedProxyConfig,
  type ProviderModel,
} from "./provider-registry.ts";

type StatusLevel = "idle" | "running" | "unavailable";
type UiLevel = "info" | "warn" | "error" | "success";

type ExtensionCtx = {
  model?: ProviderModel;
  ui: {
    notify(message: string, level?: UiLevel): void;
    setStatus?: (id: string, text: string) => void;
  };
};

type ModelSelectEvent = { model?: ProviderModel };

interface ManagedProxyState {
  provider: ManagedProvider;
  port: number;
  rootUrl: string;
  routedBaseUrl: string;
  status: StatusLevel;
  lastHealthyAt?: number;
  lastError?: string;
}

interface PerfSummary {
  requestCount: number;
  tokensSaved: number;
  savingsUsd?: number;
  savingsPercent: number;
  basis: "history" | "runtime";
}

interface SupervisorState {
  proxies: Map<ManagedProvider, ManagedProxyState>;
  perf: Map<ManagedProvider, PerfSummary>;
}

const STATUS_SLOT = "pi-headroom";
const DEFAULT_HOST = process.env.PI_HEADROOM_HOST?.trim() || "127.0.0.1";
const HEADROOM_BIN = process.env.PI_HEADROOM_BIN?.trim() || "headroom";
const STATUS_COMMAND =
  process.env.PI_HEADROOM_STATUS_COMMAND?.trim() || "headroom-status";
const START_COMMAND =
  process.env.PI_HEADROOM_START_COMMAND?.trim() || "headroom-start";
const VERBOSE = /^(1|true|yes|on)$/i.test(process.env.PI_HEADROOM_VERBOSE ?? "");
const PROBE_TIMEOUT_MS = parsePositiveInt(
  process.env.PI_HEADROOM_PROBE_TIMEOUT_MS,
  1500,
);
const START_TIMEOUT_MS = parsePositiveInt(
  process.env.PI_HEADROOM_START_TIMEOUT_MS,
  30000,
);
const PROBE_INTERVAL_MS = parsePositiveInt(
  process.env.PI_HEADROOM_PROBE_INTERVAL_MS,
  500,
);
const HEALTH_TTL_MS = parsePositiveInt(
  process.env.PI_HEADROOM_HEALTH_TTL_MS,
  5000,
);

const resolvedConfigs = Object.fromEntries(
  providerIds().map((provider) => [
    provider,
    buildManagedProxyConfig(provider, preferredPortFor(provider), DEFAULT_HOST),
  ]),
) as Record<ManagedProvider, ManagedProxyConfig>;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function globalState(): SupervisorState {
  const g = globalThis as typeof globalThis & {
    __piHeadroomSupervisor__?: Partial<SupervisorState>;
  };
  if (!g.__piHeadroomSupervisor__) g.__piHeadroomSupervisor__ = {};
  const state = g.__piHeadroomSupervisor__;
  if (!(state.proxies instanceof Map)) state.proxies = new Map();
  if (!(state.perf instanceof Map)) state.perf = new Map();
  return state as SupervisorState;
}

function getConfig(provider: ManagedProvider): ManagedProxyConfig {
  return resolvedConfigs[provider];
}

function dashboardUrl(config: ManagedProxyConfig): string {
  return `${config.rootUrl}/dashboard`;
}

function buildBaseState(config: ManagedProxyConfig): ManagedProxyState {
  return {
    provider: config.provider,
    port: config.port,
    rootUrl: config.rootUrl,
    routedBaseUrl: config.routedBaseUrl,
    status: "idle",
  };
}

function formatCompactMetric(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatSavingsPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatCompactUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(1)}`;
}

function deriveSavingsPercent(tokensSaved: number, totalInputTokens: number): number {
  const totalBefore = Math.max(0, totalInputTokens) + Math.max(0, tokensSaved);
  return totalBefore > 0 ? (tokensSaved / totalBefore) * 100 : 0;
}

function parsePerfSummary(payload: unknown): PerfSummary | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const data = payload as {
    lifetime?: {
      requests?: unknown;
      tokens_saved?: unknown;
      compression_savings_usd?: unknown;
      total_input_tokens?: unknown;
    };
    persistent_savings?: {
      lifetime?: {
        requests?: unknown;
        tokens_saved?: unknown;
        compression_savings_usd?: unknown;
        total_input_tokens?: unknown;
      };
    };
    requests?: { total?: unknown };
    tokens?: { saved?: unknown; savings_percent?: unknown };
    lifetime_stats?: {
      total_requests?: unknown;
      total_tokens_saved?: unknown;
      total_input_tokens?: unknown;
      total_estimated_savings_usd?: unknown;
    };
    total_requests?: unknown;
    total_tokens_saved?: unknown;
    total_input_tokens?: unknown;
    total_estimated_savings_usd?: unknown;
  };

  const lifetime =
    data.lifetime ?? data.persistent_savings?.lifetime ?? data.lifetime_stats;

  if (lifetime && typeof lifetime === "object") {
    const requestCount = numberOrZero(
      "requests" in lifetime ? lifetime.requests : lifetime.total_requests,
    );
    const tokensSaved = numberOrZero(
      "tokens_saved" in lifetime
        ? lifetime.tokens_saved
        : lifetime.total_tokens_saved,
    );
    const totalInputTokens = numberOrZero(
      "total_input_tokens" in lifetime ? lifetime.total_input_tokens : undefined,
    );
    const savingsUsd = numberOrUndefined(
      "compression_savings_usd" in lifetime
        ? lifetime.compression_savings_usd
        : lifetime.total_estimated_savings_usd,
    );

    if (requestCount > 0 || tokensSaved > 0 || typeof savingsUsd === "number") {
      return {
        requestCount,
        tokensSaved,
        savingsUsd,
        savingsPercent: deriveSavingsPercent(tokensSaved, totalInputTokens),
        basis: "history",
      };
    }
  }

  const requestCount = numberOrZero(
    data.requests?.total ?? data.total_requests,
  );
  const tokensSaved = numberOrZero(
    data.tokens?.saved ?? data.total_tokens_saved,
  );
  const explicitSavingsPercent = numberOrUndefined(data.tokens?.savings_percent);
  const totalInputTokens = numberOrZero(data.total_input_tokens);
  const savingsUsd = numberOrUndefined(data.total_estimated_savings_usd);

  if (
    requestCount === 0 &&
    tokensSaved === 0 &&
    explicitSavingsPercent === undefined &&
    savingsUsd === undefined
  ) {
    return undefined;
  }

  return {
    requestCount,
    tokensSaved,
    savingsUsd,
    savingsPercent:
      explicitSavingsPercent ??
      deriveSavingsPercent(tokensSaved, totalInputTokens),
    basis: "runtime",
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function probeUrl(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeLiveness(rootUrl: string): Promise<boolean> {
  for (const path of ["/livez", "/readyz", "/health"]) {
    if (await probeUrl(`${rootUrl}${path}`)) return true;
  }
  return false;
}

function probePortBindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;

    server.once("error", () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        if (settled) return;
        settled = true;
        resolve(true);
      });
    });

    server.listen(port, DEFAULT_HOST);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProxyReady(rootUrl: string): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (await probeLiveness(rootUrl)) return true;
    await sleep(PROBE_INTERVAL_MS);
  }
  return false;
}

async function refreshProxyState(provider: ManagedProvider): Promise<ManagedProxyState> {
  const config = getConfig(provider);
  const state = globalState();
  const current = state.proxies.get(provider) ?? buildBaseState(config);
  const healthy = await probeLiveness(config.rootUrl);
  current.port = config.port;
  current.rootUrl = config.rootUrl;
  current.routedBaseUrl = config.routedBaseUrl;
  current.status = healthy ? "running" : "unavailable";
  current.lastHealthyAt = healthy ? Date.now() : undefined;
  current.lastError = healthy ? undefined : buildUnavailableMessage(provider);
  state.proxies.set(provider, current);
  return current;
}

function isFreshHealthy(proxy: ManagedProxyState | undefined): boolean {
  return !!proxy?.lastHealthyAt && Date.now() - proxy.lastHealthyAt < HEALTH_TTL_MS;
}

async function ensureObservedState(provider: ManagedProvider): Promise<ManagedProxyState> {
  const current = globalState().proxies.get(provider);
  if (isFreshHealthy(current)) return current as ManagedProxyState;
  return refreshProxyState(provider);
}

async function refreshPerfSummary(
  provider: ManagedProvider,
  options: { fresh?: boolean } = {},
): Promise<void> {
  const config = getConfig(provider);
  if (!(await probeLiveness(config.rootUrl))) return;

  const urls = options.fresh
    ? [`${config.rootUrl}/stats-history`, `${config.rootUrl}/stats`]
    : [`${config.rootUrl}/stats?cached=1`, `${config.rootUrl}/stats-history`];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const payload = (await response.json()) as unknown;
      const summary = parsePerfSummary(payload);
      if (!summary) continue;
      globalState().perf.set(provider, summary);
      return;
    } catch {
      // best-effort UI metric refresh only
    }
  }
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_\-./:=]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildStartCommand(provider: ManagedProvider): string {
  const config = getConfig(provider);
  const envAssignments = Object.entries(config.env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${shellEscape(value)}`);
  return [
    ...envAssignments,
    shellEscape(HEADROOM_BIN),
    "proxy",
    "--host",
    shellEscape(DEFAULT_HOST),
    "--port",
    String(config.port),
  ].join(" ");
}

function buildUnavailableMessage(provider: ManagedProvider): string {
  const config = getConfig(provider);
  return [
    `Headroom proxy for ${provider} is not running.`,
    `Expected port: ${config.port}`,
    `Expected root URL: ${config.rootUrl}`,
    `Expected routed base URL: ${config.routedBaseUrl}`,
    `Start command: ${buildStartCommand(provider)}`,
  ].join(" ");
}

function activeStatusLine(model: ProviderModel | undefined): string {
  const provider = managedProviderFor(model);
  if (!provider) return "Headroom: off";

  const perf = globalState().perf.get(provider);
  const status = globalState().proxies.get(provider)?.status ?? "idle";
  const perfScope = perf?.basis === "history" ? "hist " : "";
  const usdSuffix =
    typeof perf?.savingsUsd === "number"
      ? ` | ${formatCompactUsd(perf.savingsUsd)}`
      : "";
  const perfSuffix = perf
    ? ` | ${perfScope}saved ${formatCompactMetric(perf.tokensSaved)}${usdSuffix} | ${formatSavingsPercent(perf.savingsPercent)}`
    : "";

  if (status === "running") {
    return `Headroom:${provider} running${perfSuffix}`;
  }
  if (status === "unavailable") {
    return `Headroom:${provider} unavailable | /${START_COMMAND} ${provider}`;
  }
  return `Headroom:${provider} idle | /${START_COMMAND} ${provider}`;
}

function isStaleCtxError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "This extension ctx is stale after session replacement or reload",
    )
  );
}

function currentModelOrUndefined(ctx: ExtensionCtx): ProviderModel | undefined {
  try {
    return ctx.model;
  } catch (error) {
    if (isStaleCtxError(error)) return undefined;
    throw error;
  }
}

function notifyUi(
  ctx: ExtensionCtx,
  message: string,
  level: "info" | "warn" | "error",
): void {
  try {
    ctx.ui.notify(message, level);
  } catch (error) {
    if (isStaleCtxError(error)) return;
    throw error;
  }
}

function updateUiStatus(ctx: ExtensionCtx, model?: ProviderModel): void {
  try {
    const resolvedModel = model ?? currentModelOrUndefined(ctx);
    ctx.ui.setStatus?.(STATUS_SLOT, activeStatusLine(resolvedModel));
  } catch (error) {
    if (isStaleCtxError(error)) return;
    throw error;
  }
}

function statusLines(model: ProviderModel | undefined): string[] {
  const activeProvider = managedProviderFor(model);
  const state = globalState();
  const relevantProviders = activeProvider
    ? [activeProvider, ...providerIds().filter((provider) => provider !== activeProvider)]
    : providerIds();

  const proxyLines = relevantProviders.flatMap((provider) => {
    const config = getConfig(provider);
    const proxy = state.proxies.get(provider);
    const status = proxy?.status ?? "idle";
    if (provider !== activeProvider && status !== "running") return [];

    const detail =
      status === "running"
        ? `running @ ${config.rootUrl} (pi routed through Headroom)`
        : `unavailable; expected ${config.rootUrl} (pi falls back to default provider)`;
    return [
      `- ${provider}: ${detail}`,
      `  routed base: ${config.routedBaseUrl}`,
      `  dashboard: ${dashboardUrl(config)}`,
    ];
  });

  const activeConfig = activeProvider ? getConfig(activeProvider) : undefined;
  return [
    `Managed provider: ${activeProvider ?? "(current model is unmanaged)"}`,
    `Current model: ${model ? `${model.provider}/${model.id ?? "(unknown)"}` : "(none)"}`,
    `Current model base URL: ${model?.baseUrl ?? "(none)"}`,
    `Expected proxy root: ${activeConfig?.rootUrl ?? "(none)"}`,
    `Expected routed base URL: ${activeConfig?.routedBaseUrl ?? "(none)"}`,
    `Active dashboard: ${activeConfig ? dashboardUrl(activeConfig) : "(none)"}`,
    `Footer status: ${activeStatusLine(model)}`,
    "Lifecycle: manual proxy management; this extension only attaches.",
    activeConfig
      ? `If unavailable, pi falls back to the provider default. Start Headroom manually on port ${activeConfig.port} to attach it.`
      : "Select a managed provider to see expected Headroom port.",
    "Proxy map:",
    ...(proxyLines.length ? proxyLines : ["(no running managed provider proxies observed)"]),
  ];
}

async function reconcileProviderRouting(
  pi: ExtensionAPI,
  provider: ManagedProvider,
): Promise<ManagedProxyState> {
  const proxy = await ensureObservedState(provider);
  if (proxy.status === "running") {
    registerManagedProvider(pi, provider, getConfig(provider));
    await refreshPerfSummary(provider);
  } else {
    pi.unregisterProvider(provider);
    globalState().perf.delete(provider);
  }
  return proxy;
}

async function refreshForModel(
  pi: ExtensionAPI,
  model: ProviderModel | undefined,
): Promise<void> {
  const provider = managedProviderFor(model);
  if (!provider) return;
  await reconcileProviderRouting(pi, provider);
}

function parseProviderArg(raw: string | undefined): ManagedProvider | "all" | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "all") return "all";
  return providerIds().includes(value as ManagedProvider)
    ? (value as ManagedProvider)
    : undefined;
}

function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand(STATUS_COMMAND, {
    description:
      "Show Headroom routing, expected proxy ports, and observed proxy status.",
    handler: async (args: string, ctx: ExtensionCtx) => {
      const selected = parseProviderArg(args);
      if (args.trim() && !selected) {
        const known = [...providerIds(), "all"].join(", ");
        notifyUi(
          ctx,
          `Unknown provider ${JSON.stringify(args.trim())}. Use ${known}.`,
          "error",
        );
        return;
      }

      const currentProvider = managedProviderFor(currentModelOrUndefined(ctx));
      const providers = selected
        ? selected !== "all"
          ? [selected]
          : providerIds()
        : currentProvider
          ? [currentProvider]
          : [];
      if (!providers.length) {
        notifyUi(
          ctx,
          "No managed provider selected. Choose a managed model first or pass /headroom-status [provider|all].",
          "error",
        );
        return;
      }
      await Promise.all(
        providers.map((provider) => reconcileProviderRouting(pi, provider)),
      );

      const model = currentModelOrUndefined(ctx);
      const activeProvider = managedProviderFor(model);
      if (activeProvider && providers.includes(activeProvider)) {
        await refreshPerfSummary(activeProvider, { fresh: true });
      }
      updateUiStatus(ctx, model);
      notifyUi(ctx, statusLines(model).join("\n"), "info");
    },
  });

  pi.registerCommand(START_COMMAND, {
    description:
      "Start Headroom on the canonical configured port. Usage: /headroom-start [provider|all]",
    handler: async (args: string, ctx: ExtensionCtx) => {
      const selected = parseProviderArg(args);
      if (args.trim() && !selected) {
        const known = [...providerIds(), "all"].join(", ");
        notifyUi(
          ctx,
          `Unknown provider ${JSON.stringify(args.trim())}. Use ${known}.`,
          "error",
        );
        return;
      }

      const currentProvider = managedProviderFor(currentModelOrUndefined(ctx));
      const providers = selected
        ? selected !== "all"
          ? [selected]
          : providerIds()
        : currentProvider
          ? [currentProvider]
          : [];
      if (!providers.length) {
        notifyUi(
          ctx,
          "No managed provider selected. Choose a managed model first or pass /headroom-start [provider|all].",
          "error",
        );
        return;
      }

      const started: ManagedProvider[] = [];
      const alreadyRunning: ManagedProvider[] = [];
      const failures: string[] = [];

      for (const provider of providers) {
        const config = getConfig(provider);
        if (await probeLiveness(config.rootUrl)) {
          await reconcileProviderRouting(pi, provider);
          alreadyRunning.push(provider);
          continue;
        }

        if (!(await probePortBindable(config.port))) {
          failures.push(
            `${provider}: port ${config.port} is occupied. Expected command: ${buildStartCommand(provider)}`,
          );
          continue;
        }

        try {
          const child = spawn(
            HEADROOM_BIN,
            ["proxy", "--host", DEFAULT_HOST, "--port", String(config.port)],
            {
              env: { ...process.env, ...config.env },
              detached: true,
              stdio: "ignore",
            },
          );
          child.unref();
        } catch (error) {
          failures.push(
            `${provider}: failed to start Headroom via ${JSON.stringify(HEADROOM_BIN)}. ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }

        const ready = await waitForProxyReady(config.rootUrl);
        if (!ready) {
          failures.push(
            `${provider}: timed out waiting for proxy on ${config.rootUrl}. Expected command: ${buildStartCommand(provider)}`,
          );
          continue;
        }

        await reconcileProviderRouting(pi, provider);
        started.push(provider);
      }

      const model = currentModelOrUndefined(ctx);
      updateUiStatus(ctx, model);

      const notices: string[] = [];
      if (started.length) notices.push(`Started Headroom for ${started.join(", ")}.`);
      if (alreadyRunning.length) notices.push(`Already running: ${alreadyRunning.join(", ")}.`);
      if (failures.length) notices.push(...failures);

      notifyUi(
        ctx,
        notices.length ? notices.join("\n") : "No managed providers selected.",
        failures.length ? "warn" : "info",
      );
    },
  });
}

export default async function headroomProviderSupervisor(
  pi: ExtensionAPI,
): Promise<void> {
  for (const provider of providerIds()) {
    pi.unregisterProvider(provider);
  }
  registerCommands(pi);

  pi.on("session_start", async (_event: unknown, ctx: ExtensionCtx) => {
    const model = currentModelOrUndefined(ctx);
    await refreshForModel(pi, model);
    updateUiStatus(ctx, model);
  });

  pi.on("model_select", async (event: ModelSelectEvent, ctx: ExtensionCtx) => {
    await refreshForModel(pi, event.model);
    updateUiStatus(ctx, event.model);
  });

  pi.on("before_agent_start", async (_event: unknown, ctx: ExtensionCtx) => {
    const model = currentModelOrUndefined(ctx);
    const provider = managedProviderFor(model);
    if (!provider) {
      updateUiStatus(ctx, model);
      return;
    }

    const proxy = await reconcileProviderRouting(pi, provider);
    updateUiStatus(ctx, model);
    if (proxy.status !== "running") {
      notifyUi(
        ctx,
        `${buildUnavailableMessage(provider)} Falling back to the provider default.`,
        "warn",
      );
    }
  });

  pi.on("agent_end", async (_event: unknown, ctx: ExtensionCtx) => {
    const model = currentModelOrUndefined(ctx);
    const provider = managedProviderFor(model);
    if (!provider) {
      updateUiStatus(ctx, model);
      return;
    }
    await reconcileProviderRouting(pi, provider);
    await refreshPerfSummary(provider, { fresh: true });
    updateUiStatus(ctx, model);
  });

  if (VERBOSE) {
    pi.on("session_start", async (_event: unknown, ctx: ExtensionCtx) => {
      const model = currentModelOrUndefined(ctx);
      const provider = managedProviderFor(model);
      if (!provider) return;
      const proxy = await ensureObservedState(provider);
      if (proxy.status !== "running") {
        notifyUi(
          ctx,
          `${buildUnavailableMessage(provider)} Using the provider default until Headroom is available.`,
          "warn",
        );
      }
    });
  }
}
