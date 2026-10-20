import { createStrategyConfigParser } from "@tradejs/strategy-kit/config";
import type { StrategyConfig } from "@tradejs/types";

export const defaultConfig = {
  ENV: "BACKTEST",
  MAKE_ORDERS: true,
  INTERVAL: "60" as const,
  ENABLE: true,
  MAX_LOSS_VALUE: 10,
  RISK_FEE_RATE: 0.001,
  RISK_SLIPPAGE_BPS: 0,
  RISK_MARKET_IMPACT_BPS: 0,
  AI_ENABLED: false,
  ML_ENABLED: false,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: "open" as const,
  BACKTEST_ENTRY_DELAY_BARS: 1,
  TP_FAST_EMA: 20,
  TP_SLOW_EMA: 50,
  TP_SLOPE_BARS: 3,
  TP_RSI_PERIOD: 5,
  TP_RSI_PULLBACK: 40,
  TP_PENDING_BARS: 8,
  TP_ATR_PERIOD: 14,
  TP_STOP_BUFFER_ATR: 0.25,
  TP_TRAIL_ATR: 3,
  TP_MIN_STOP_ATR: 0.5,
  TP_MIN_STOP_PCT: 0.2,
  TP_MAX_HOLD_HOURS: 72,
  TP_TARGET_R: 4,
  TP_FIGURE_POINTS: 256,
  LONG: { enable: true, direction: "LONG" as const },
  SHORT: { enable: true, direction: "SHORT" as const },
};

export type TrendPullbackConfig = StrategyConfig &
  Omit<typeof defaultConfig, "INTERVAL"> & { INTERVAL: "15" | "60" };

const parse = createStrategyConfigParser<TrendPullbackConfig>({
  strategyName: "TrendPullback",
  defaults: defaultConfig,
});

export function parseConfig(input: unknown): TrendPullbackConfig {
  const config = parse(input);
  const fail = (field: string) => {
    throw new Error(`TrendPullback.${field} is invalid`);
  };
  if (!["15", "60"].includes(config.INTERVAL)) fail("INTERVAL");
  for (const key of [
    "TP_FAST_EMA",
    "TP_SLOW_EMA",
    "TP_SLOPE_BARS",
    "TP_RSI_PERIOD",
    "TP_PENDING_BARS",
    "TP_ATR_PERIOD",
    "TP_FIGURE_POINTS",
  ] as const) {
    if (
      !Number.isInteger(config[key]) ||
      config[key] < 1 ||
      config[key] > 10000
    )
      fail(key);
  }
  if (config.TP_FAST_EMA >= config.TP_SLOW_EMA) fail("TP_FAST_EMA");
  if (config.TP_RSI_PULLBACK <= 0 || config.TP_RSI_PULLBACK >= 50)
    fail("TP_RSI_PULLBACK");
  for (const key of [
    "MAX_LOSS_VALUE",
    "TP_STOP_BUFFER_ATR",
    "TP_TRAIL_ATR",
    "TP_MIN_STOP_ATR",
    "TP_MIN_STOP_PCT",
    "TP_MAX_HOLD_HOURS",
    "TP_TARGET_R",
  ] as const) {
    if (config[key] <= 0) fail(key);
  }
  for (const key of [
    "RISK_FEE_RATE",
    "RISK_SLIPPAGE_BPS",
    "RISK_MARKET_IMPACT_BPS",
  ] as const) {
    if (config[key] < 0) fail(key);
  }
  if (config.LONG.direction !== "LONG" || config.SHORT.direction !== "SHORT")
    fail("direction");
  if (config.AI_ENABLED || config.ML_ENABLED || config.CLOSE_OPPOSITE_POSITIONS)
    fail("unsupported runtime policy");
  return config;
}

// Fixed examples, not results of a parameter search. Both trade only USDT contracts.
export const trendPullback1hConfig = parseConfig({ INTERVAL: "60" });
export const trendPullback15m1hConfig = parseConfig({ INTERVAL: "15" });
