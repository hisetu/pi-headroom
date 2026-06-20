import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { githubCopilotOAuthProvider } from "@earendil-works/pi-ai/oauth";

const MANAGED_PROVIDERS = [
  "xai",
  "github-copilot",
  "openai",
  "anthropic",
  "openrouter",
  "deepseek",
  "groq",
  "together",
  "mistral",
  "fireworks",
  "google",
  "google-vertex",
  "cerebras",
  "nvidia",
  "huggingface",
  "ant-ling",
  "moonshotai",
  "moonshotai-cn",
  "minimax",
  "minimax-cn",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
  "kimi-coding",
] as const;

const MANAGED_PROVIDER_SET = new Set<string>(MANAGED_PROVIDERS);

type ProviderFamily = "openai" | "anthropic" | "gemini" | "custom";
type RoutedBaseStyle = "openai" | "root" | "google-v1beta";

type CopilotOAuthProvider = {
  login?: (...args: unknown[]) => unknown;
  refreshToken?: (...args: unknown[]) => unknown;
  getApiKey?: (...args: unknown[]) => unknown;
  modifyModels?: (
    models: ProviderModel[],
    credentials: unknown,
  ) => ProviderModel[];
};

export type ManagedProvider = (typeof MANAGED_PROVIDERS)[number];

export type ProviderModel = {
  provider: string;
  id?: string;
  baseUrl?: string;
  [key: string]: unknown;
};

export interface ManagedProxyConfig {
  provider: ManagedProvider;
  preferredPort: number;
  port: number;
  rootUrl: string;
  routedBaseUrl: string;
  env: Record<string, string>;
}

export interface ManagedProviderSpec {
  provider: ManagedProvider;
  displayName: string;
  family: ProviderFamily;
  preferredPortEnv: string;
  defaultPreferredPort: number;
  buildProxyEnv(): Record<string, string>;
  buildRoutedBaseUrl(rootUrl: string): string;
  register(pi: ExtensionAPI, config: ManagedProxyConfig): void;
}

interface SimpleProviderSpecOptions {
  provider: ManagedProvider;
  displayName: string;
  family: ProviderFamily;
  preferredPortEnv: string;
  defaultPreferredPort: number;
  upstreamEnvKey: string;
  defaultUpstream: string;
  routedBaseStyle: RoutedBaseStyle;
  extraEnv?: Record<string, string>;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Unsupported URL protocol ${JSON.stringify(url.protocol)} for ${JSON.stringify(raw)}.`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

function openaiStyleBaseUrl(rootUrl: string): string {
  return `${rootUrl}/v1`;
}

function rootBaseUrl(rootUrl: string): string {
  return rootUrl;
}

function googleV1betaBaseUrl(rootUrl: string): string {
  return `${rootUrl}/v1beta`;
}

function routedBaseUrlFor(style: RoutedBaseStyle, rootUrl: string): string {
  switch (style) {
    case "openai":
      return openaiStyleBaseUrl(rootUrl);
    case "google-v1beta":
      return googleV1betaBaseUrl(rootUrl);
    case "root":
    default:
      return rootBaseUrl(rootUrl);
  }
}

function registerBaseUrlOverride(
  provider: ManagedProvider,
  pi: ExtensionAPI,
  config: ManagedProxyConfig,
): void {
  pi.registerProvider(provider, {
    baseUrl: config.routedBaseUrl,
  });
}

function makeSimpleProviderSpec(
  options: SimpleProviderSpecOptions,
): ManagedProviderSpec {
  return {
    provider: options.provider,
    displayName: options.displayName,
    family: options.family,
    preferredPortEnv: options.preferredPortEnv,
    defaultPreferredPort: options.defaultPreferredPort,
    buildProxyEnv() {
      return {
        [options.upstreamEnvKey]:
          process.env[
            options.preferredPortEnv.replace(/_PORT$/, "_UPSTREAM")
          ]?.trim() || options.defaultUpstream,
        ...(options.extraEnv ?? {}),
      };
    },
    buildRoutedBaseUrl(rootUrl: string) {
      return routedBaseUrlFor(options.routedBaseStyle, rootUrl);
    },
    register(pi, config) {
      registerBaseUrlOverride(options.provider, pi, config);
    },
  };
}

const OPENAI_FAMILY_ENV = {
  HEADROOM_BACKEND: "openai",
  LITELLM_SUPPRESS_DEBUG_INFO: "True",
};

const PROVIDER_SPECS: Record<ManagedProvider, ManagedProviderSpec> = {
  xai: makeSimpleProviderSpec({
    provider: "xai",
    displayName: "xAI",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_XAI_PORT",
    defaultPreferredPort: 8787,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.x.ai",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  "github-copilot": {
    provider: "github-copilot",
    displayName: "GitHub Copilot",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_COPILOT_PORT",
    defaultPreferredPort: 8788,
    buildProxyEnv() {
      return {
        HEADROOM_BACKEND: "openai",
        OPENAI_TARGET_API_URL:
          process.env.PI_HEADROOM_COPILOT_UPSTREAM?.trim() ||
          "https://api.githubcopilot.com",
        GITHUB_COPILOT_USE_TOKEN_EXCHANGE:
          process.env.PI_HEADROOM_COPILOT_USE_TOKEN_EXCHANGE?.trim() || "1",
        LITELLM_SUPPRESS_DEBUG_INFO: "True",
      };
    },
    buildRoutedBaseUrl(rootUrl: string) {
      return openaiStyleBaseUrl(rootUrl);
    },
    register(pi, config) {
      const oauthProvider = githubCopilotOAuthProvider as CopilotOAuthProvider;
      pi.registerProvider("github-copilot", {
        baseUrl: config.routedBaseUrl,
        oauth: {
          name: "GitHub Copilot via Headroom",
          login: oauthProvider.login,
          refreshToken: oauthProvider.refreshToken,
          getApiKey: oauthProvider.getApiKey,
          modifyModels(models: ProviderModel[], credentials: unknown) {
            const oauthAdjusted = oauthProvider.modifyModels
              ? oauthProvider.modifyModels(models, credentials)
              : models;
            return oauthAdjusted.map((model) =>
              model.provider === "github-copilot"
                ? { ...model, baseUrl: config.routedBaseUrl }
                : model,
            );
          },
        },
      });
    },
  },
  openai: makeSimpleProviderSpec({
    provider: "openai",
    displayName: "OpenAI",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_OPENAI_PORT",
    defaultPreferredPort: 8789,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.openai.com",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  anthropic: makeSimpleProviderSpec({
    provider: "anthropic",
    displayName: "Anthropic",
    family: "anthropic",
    preferredPortEnv: "PI_HEADROOM_ANTHROPIC_PORT",
    defaultPreferredPort: 8790,
    upstreamEnvKey: "ANTHROPIC_TARGET_API_URL",
    defaultUpstream: "https://api.anthropic.com",
    routedBaseStyle: "root",
  }),
  openrouter: makeSimpleProviderSpec({
    provider: "openrouter",
    displayName: "OpenRouter",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_OPENROUTER_PORT",
    defaultPreferredPort: 8791,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://openrouter.ai/api",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  deepseek: makeSimpleProviderSpec({
    provider: "deepseek",
    displayName: "DeepSeek",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_DEEPSEEK_PORT",
    defaultPreferredPort: 8792,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.deepseek.com",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  groq: makeSimpleProviderSpec({
    provider: "groq",
    displayName: "Groq",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_GROQ_PORT",
    defaultPreferredPort: 8793,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.groq.com/openai",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  together: makeSimpleProviderSpec({
    provider: "together",
    displayName: "Together",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_TOGETHER_PORT",
    defaultPreferredPort: 8794,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.together.ai",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  mistral: makeSimpleProviderSpec({
    provider: "mistral",
    displayName: "Mistral",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_MISTRAL_PORT",
    defaultPreferredPort: 8795,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.mistral.ai",
    routedBaseStyle: "root",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  fireworks: makeSimpleProviderSpec({
    provider: "fireworks",
    displayName: "Fireworks",
    family: "anthropic",
    preferredPortEnv: "PI_HEADROOM_FIREWORKS_PORT",
    defaultPreferredPort: 8796,
    upstreamEnvKey: "ANTHROPIC_TARGET_API_URL",
    defaultUpstream: "https://api.fireworks.ai/inference",
    routedBaseStyle: "root",
  }),
  google: makeSimpleProviderSpec({
    provider: "google",
    displayName: "Google Gemini",
    family: "gemini",
    preferredPortEnv: "PI_HEADROOM_GEMINI_PORT",
    defaultPreferredPort: 8797,
    upstreamEnvKey: "GEMINI_TARGET_API_URL",
    defaultUpstream: "https://generativelanguage.googleapis.com",
    routedBaseStyle: "google-v1beta",
  }),
  "google-vertex": makeSimpleProviderSpec({
    provider: "google-vertex",
    displayName: "Google Vertex",
    family: "gemini",
    preferredPortEnv: "PI_HEADROOM_VERTEX_PORT",
    defaultPreferredPort: 8798,
    upstreamEnvKey: "VERTEX_TARGET_API_URL",
    defaultUpstream: "https://us-central1-aiplatform.googleapis.com",
    routedBaseStyle: "root",
  }),
  cerebras: makeSimpleProviderSpec({
    provider: "cerebras",
    displayName: "Cerebras",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_CEREBRAS_PORT",
    defaultPreferredPort: 8799,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.cerebras.ai",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  nvidia: makeSimpleProviderSpec({
    provider: "nvidia",
    displayName: "NVIDIA NIM",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_NVIDIA_PORT",
    defaultPreferredPort: 8800,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://integrate.api.nvidia.com",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  huggingface: makeSimpleProviderSpec({
    provider: "huggingface",
    displayName: "Hugging Face",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_HUGGINGFACE_PORT",
    defaultPreferredPort: 8801,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://router.huggingface.co",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  "ant-ling": makeSimpleProviderSpec({
    provider: "ant-ling",
    displayName: "Ant Ling",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_ANT_LING_PORT",
    defaultPreferredPort: 8802,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.ant-ling.com",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  moonshotai: makeSimpleProviderSpec({
    provider: "moonshotai",
    displayName: "Moonshot AI",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_MOONSHOTAI_PORT",
    defaultPreferredPort: 8803,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.moonshot.ai",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  "moonshotai-cn": makeSimpleProviderSpec({
    provider: "moonshotai-cn",
    displayName: "Moonshot AI CN",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_MOONSHOTAI_CN_PORT",
    defaultPreferredPort: 8804,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.moonshot.cn",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  minimax: makeSimpleProviderSpec({
    provider: "minimax",
    displayName: "MiniMax",
    family: "anthropic",
    preferredPortEnv: "PI_HEADROOM_MINIMAX_PORT",
    defaultPreferredPort: 8805,
    upstreamEnvKey: "ANTHROPIC_TARGET_API_URL",
    defaultUpstream: "https://api.minimax.io/anthropic",
    routedBaseStyle: "root",
  }),
  "minimax-cn": makeSimpleProviderSpec({
    provider: "minimax-cn",
    displayName: "MiniMax CN",
    family: "anthropic",
    preferredPortEnv: "PI_HEADROOM_MINIMAX_CN_PORT",
    defaultPreferredPort: 8806,
    upstreamEnvKey: "ANTHROPIC_TARGET_API_URL",
    defaultUpstream: "https://api.minimaxi.com/anthropic",
    routedBaseStyle: "root",
  }),
  xiaomi: makeSimpleProviderSpec({
    provider: "xiaomi",
    displayName: "Xiaomi MiMo",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_XIAOMI_PORT",
    defaultPreferredPort: 8807,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://api.xiaomimimo.com",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  "xiaomi-token-plan-cn": makeSimpleProviderSpec({
    provider: "xiaomi-token-plan-cn",
    displayName: "Xiaomi Token Plan CN",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_XIAOMI_TOKEN_CN_PORT",
    defaultPreferredPort: 8808,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://token-plan-cn.xiaomimimo.com",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  "xiaomi-token-plan-ams": makeSimpleProviderSpec({
    provider: "xiaomi-token-plan-ams",
    displayName: "Xiaomi Token Plan AMS",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_XIAOMI_TOKEN_AMS_PORT",
    defaultPreferredPort: 8809,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://token-plan-ams.xiaomimimo.com",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  "xiaomi-token-plan-sgp": makeSimpleProviderSpec({
    provider: "xiaomi-token-plan-sgp",
    displayName: "Xiaomi Token Plan SGP",
    family: "openai",
    preferredPortEnv: "PI_HEADROOM_XIAOMI_TOKEN_SGP_PORT",
    defaultPreferredPort: 8810,
    upstreamEnvKey: "OPENAI_TARGET_API_URL",
    defaultUpstream: "https://token-plan-sgp.xiaomimimo.com",
    routedBaseStyle: "openai",
    extraEnv: OPENAI_FAMILY_ENV,
  }),
  "kimi-coding": makeSimpleProviderSpec({
    provider: "kimi-coding",
    displayName: "Kimi Coding",
    family: "anthropic",
    preferredPortEnv: "PI_HEADROOM_KIMI_CODING_PORT",
    defaultPreferredPort: 8811,
    upstreamEnvKey: "ANTHROPIC_TARGET_API_URL",
    defaultUpstream: "https://api.kimi.com/coding",
    routedBaseStyle: "root",
  }),
};

export function providerIds(): ManagedProvider[] {
  return [...MANAGED_PROVIDERS];
}

export function isManagedProvider(
  provider: string,
): provider is ManagedProvider {
  return MANAGED_PROVIDER_SET.has(provider);
}

export function managedProviderFor(
  model: { provider: string } | undefined,
): ManagedProvider | undefined {
  if (!model) return undefined;
  return isManagedProvider(model.provider) ? model.provider : undefined;
}

export function getManagedProviderSpec(
  provider: ManagedProvider,
): ManagedProviderSpec {
  return PROVIDER_SPECS[provider];
}

export function preferredPortFor(provider: ManagedProvider): number {
  const spec = getManagedProviderSpec(provider);
  return parsePositiveInt(
    process.env[spec.preferredPortEnv],
    spec.defaultPreferredPort,
  );
}

export function buildManagedProxyConfig(
  provider: ManagedProvider,
  port: number,
  host: string,
): ManagedProxyConfig {
  const spec = getManagedProviderSpec(provider);
  const preferredPort = preferredPortFor(provider);
  const rootUrl = normalizeUrl(`http://${host}:${port}`);
  return {
    provider,
    preferredPort,
    port,
    rootUrl,
    routedBaseUrl: spec.buildRoutedBaseUrl(rootUrl),
    env: spec.buildProxyEnv(),
  };
}

export function registerManagedProvider(
  pi: ExtensionAPI,
  provider: ManagedProvider,
  config: ManagedProxyConfig,
): void {
  getManagedProviderSpec(provider).register(pi, config);
}

export function registerManagedProviders(
  pi: ExtensionAPI,
  getConfig: (provider: ManagedProvider) => ManagedProxyConfig,
): void {
  for (const provider of providerIds()) {
    registerManagedProvider(pi, provider, getConfig(provider));
  }
}
