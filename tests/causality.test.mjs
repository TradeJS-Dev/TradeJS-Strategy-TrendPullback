import assert from "node:assert/strict";
import test from "node:test";
import { advanceEngine, createEngineState } from "../dist/index.js";
import { config, candle, harness, setup, HOUR, mirror } from "./helpers.mjs";

function quarters(hours) {
  return hours.flatMap((h, i) =>
    [0, 1, 2, 3].map((q) => candle(i * 4 + q, h.close, HOUR / 4)),
  );
}
test("15m uses exactly four closed quarters and the same hourly EMA as 1h", () => {
  const hourly = setup();
  const cfg = config({ INTERVAL: "15" });
  const fast = createEngineState();
  const slow = createEngineState();
  for (let i = 0; i < hourly.length; i++) {
    const previous = { fast: fast.fast, slow: fast.slow, trend: fast.trend };
    for (let q = 0; q < 4; q++) {
      advanceEngine(fast, cfg, candle(i * 4 + q, hourly[i].close, HOUR / 4));
      if (q < 3)
        assert.deepEqual(
          { fast: fast.fast, slow: fast.slow, trend: fast.trend },
          previous,
        );
    }
    advanceEngine(slow, config(), hourly[i]);
    assert.equal(fast.fast, slow.fast);
    assert.equal(fast.slow, slow.slow);
    assert.equal(fast.trend, slow.trend);
  }
});
test("partial first hour and a missing quarter never update the hourly trend", () => {
  const cfg = config({ INTERVAL: "15" });
  const state = createEngineState();
  for (const i of [1, 2, 3])
    advanceEngine(state, cfg, candle(i, 100 + i, HOUR / 4));
  assert.equal(state.trendBars, 0);
  advanceEngine(state, cfg, candle(4, 104, HOUR / 4));
  advanceEngine(state, cfg, candle(6, 106, HOUR / 4));
  advanceEngine(state, cfg, candle(7, 107, HOUR / 4));
  assert.equal(state.trendBars, 0);
  for (const i of [8, 9, 10, 11])
    advanceEngine(state, cfg, candle(i, 100 + i, HOUR / 4));
  assert.equal(state.trendBars, 1);
});
test("adding future history changes neither signals nor core decisions in either mode", async () => {
  for (const interval of ["60", "15"]) {
    const cfg = config({ INTERVAL: interval });
    const candles = interval === "60" ? setup() : quarters(setup());
    // Test every prefix, including cuts within an unfinished hour.
    for (let cut = 1; cut < candles.length; cut++) {
      const state = createEngineState();
      const prefix = candles
        .slice(0, cut)
        .map((c) => advanceEngine(state, cfg, c));
      const fullState = createEngineState();
      const full = candles.map((c) => advanceEngine(fullState, cfg, c));
      assert.deepEqual(prefix, full.slice(0, cut));
    }
    const future = Array.from({ length: 16 }, (_, j) =>
      candle(
        candles.length + j,
        10000 + j,
        interval === "60" ? HOUR : HOUR / 4,
      ),
    );
    const streaming = harness(cfg);
    const preloaded = harness(cfg, [...candles, ...future]);
    for (const c of candles)
      assert.deepEqual(await preloaded.next(c), await streaming.next(c));
    // Reconstructed first decision also filters a future-filled initial array.
    const start = Math.floor(candles.length / 2);
    const pastOnly = harness(cfg, candles.slice(0, start));
    const all = harness(cfg, [...candles, ...future]);
    assert.deepEqual(
      await all.next(candles[start]),
      await pastOnly.next(candles[start]),
    );
  }
});
test("JSON restoration within an unfinished hour is identical through future entries", () => {
  const cfg = config({ INTERVAL: "15" });
  const candles = quarters(setup());
  const state = createEngineState();
  const split = 41;
  candles.slice(0, split).forEach((c) => advanceEngine(state, cfg, c));
  const restored = JSON.parse(JSON.stringify(state));
  for (const c of candles.slice(split))
    assert.deepEqual(
      advanceEngine(restored, cfg, c),
      advanceEngine(state, cfg, c),
    );
  assert.deepEqual(restored, state);
});
test("15m confirms an execution pullback against the last closed 1h direction", () => {
  for (const short of [false, true]) {
    const cfg = config({ INTERVAL: "15" });
    const state = createEngineState();
    const bars = quarters(setup().slice(0, 50));
    if (short) bars.forEach((c) => advanceEngine(state, cfg, mirror(c)));
    else bars.forEach((c) => advanceEngine(state, cfg, c));
    const next = (c) => advanceEngine(state, cfg, short ? mirror(c) : c);
    assert.equal(next(candle(200, 147, HOUR / 4)).event, "PULLBACK_STARTED");
    const signal = next(candle(201, 150, HOUR / 4)).signal;
    assert.ok(signal);
    assert.equal(signal.direction, short ? "SHORT" : "LONG");
    assert.equal(state.hour.count, 2);
  }
});
