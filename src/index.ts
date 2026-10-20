import { defineStrategyPlugin } from "@tradejs/core/config";
import { TrendPullbackStrategyDefinition } from "./TrendPullback/strategy.js";
export { TrendPullbackStrategyDefinition } from "./TrendPullback/strategy.js";
export { trendPullbackManifest } from "./TrendPullback/manifest.js";
export {
  defaultConfig as trendPullbackDefaultConfig,
  parseConfig,
  trendPullback1hConfig,
  trendPullback15m1hConfig,
} from "./TrendPullback/config.js";
export type { TrendPullbackConfig } from "./TrendPullback/config.js";
export {
  createTrendPullbackCore,
  createTrendPullbackState,
  advanceTrailingStop,
} from "./TrendPullback/core.js";
export type { TrendPullbackState, TradeState } from "./TrendPullback/core.js";
export { createEngineState, advanceEngine } from "./TrendPullback/engine.js";
export type {
  EngineState,
  EngineResult,
  PullbackSignal,
} from "./TrendPullback/engine.js";
export { buildTrendPullbackFigures } from "./TrendPullback/figures.js";
export const strategyEntries = [TrendPullbackStrategyDefinition];
export default defineStrategyPlugin({ strategyEntries });
