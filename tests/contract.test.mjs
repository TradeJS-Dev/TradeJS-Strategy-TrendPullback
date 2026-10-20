import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import plugin, {
  strategyEntries,
  parseConfig,
  trendPullbackDefaultConfig,
  trendPullback1hConfig,
  trendPullback15m1hConfig,
} from "../dist/index.js";

test("plugin exports one strict TrendPullback strategy in ESM and CommonJS", () => {
  assert.equal(strategyEntries.length, 1);
  assert.equal(strategyEntries[0].manifest.name, "TrendPullback");
  assert.deepEqual(plugin.strategyEntries, strategyEntries);
  assert.deepEqual(parseConfig({}), trendPullbackDefaultConfig);
  assert.equal(
    createRequire(import.meta.url)("../dist/index.cjs").strategyEntries[0]
      .manifest.name,
    "TrendPullback",
  );
});
test("config rejects typos, coercion and invalid strategy settings", () => {
  for (const input of [
    null,
    [],
    { TP_RSI_PEROD: 2 },
    { TP_FAST_EMA: "10" },
    { TP_FAST_EMA: NaN },
    { TP_FAST_EMA: 0 },
    { TP_FAST_EMA: 50 },
    { TP_SLOPE_BARS: 1.5 },
    { TP_RSI_PULLBACK: 50 },
    { TP_PENDING_BARS: 0 },
    { TP_MAX_HOLD_HOURS: 0 },
    { TP_MIN_STOP_PCT: 0 },
    { RISK_FEE_RATE: -1 },
    { INTERVAL: "5" },
    { LONG: { direction: "SHORT" } },
    { AI_ENABLED: true },
    { CLOSE_OPPOSITE_POSITIONS: true },
  ])
    assert.throws(() => parseConfig(input));
});
test("independent reproducible presets differ only by execution interval", () => {
  assert.equal(trendPullback1hConfig.INTERVAL, "60");
  assert.equal(trendPullback15m1hConfig.INTERVAL, "15");
  assert.deepEqual(
    { ...trendPullback1hConfig, INTERVAL: "15" },
    trendPullback15m1hConfig,
  );
  const parsed = parseConfig({ LONG: { enable: false } });
  assert.equal(parsed.LONG.enable, false);
  assert.equal(trendPullback1hConfig.LONG.enable, true);
  assert.equal(trendPullback1hConfig.MAX_LOSS_VALUE, 10);
});
