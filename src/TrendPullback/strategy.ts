import type { ValidatedStrategyRegistryEntry } from "@tradejs/strategy-kit/config";
import type { TrendPullbackConfig } from "./config.js";
import { defaultConfig, parseConfig } from "./config.js";
import { createTrendPullbackCore } from "./core.js";
import { trendPullbackManifest } from "./manifest.js";
export const TrendPullbackStrategyDefinition: ValidatedStrategyRegistryEntry<TrendPullbackConfig> =
  {
    defaults: defaultConfig,
    parseConfig,
    createCore: createTrendPullbackCore,
    manifest: trendPullbackManifest,
  };
