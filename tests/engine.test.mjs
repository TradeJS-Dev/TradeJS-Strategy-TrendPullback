import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceEngine,
  createEngineState,
  advanceTrailingStop,
  buildTrendPullbackFigures,
} from "../dist/index.js";
import { config, history, setup, candle, mirror, HOUR } from "./helpers.mjs";

function run(candles, cfg = config(), state = createEngineState()) {
  return { state, results: candles.map((c) => advanceEngine(state, cfg, c)) };
}
test("LONG and SHORT events, RSI, extrema and stops are mirrored", () => {
  const candles = setup();
  const long = run(candles);
  const short = run(candles.map(mirror));
  assert.deepEqual(
    long.results.map((r) => r.event),
    short.results.map((r) => r.event),
  );
  const l = long.results.at(-1).signal;
  const s = short.results.at(-1).signal;
  assert.ok(l && s);
  assert.equal(l.direction, "LONG");
  assert.equal(s.direction, "SHORT");
  assert.equal(l.stop, 400 - s.stop);
  assert.equal(l.extreme, 400 - s.extreme);
  for (let i = 0; i < candles.length; i++) {
    if (long.results[i].rsi !== null)
      assert.ok(
        Math.abs(long.results[i].rsi + short.results[i].rsi - 100) < 1e-10,
      );
  }
});
test("registration precedes confirmation, whose own wick belongs to the extreme", () => {
  const candles = [
    ...history(),
    candle(50, 147, HOUR, { high: 146 + 2 }),
    candle(51, 150, HOUR, { low: 145 }),
  ];
  const { state, results } = run(candles);
  assert.equal(results.at(-2).event, "PULLBACK_STARTED");
  assert.equal(results.at(-2).signal, null);
  const signal = results.at(-1).signal;
  assert.ok(signal);
  assert.ok(signal.confirmedAt > signal.timestamp);
  assert.equal(signal.extreme, 145);
  assert.equal(signal.extremeTimestamp, 51 * HOUR);
  const figures = buildTrendPullbackFigures(state);
  assert.ok(
    figures.points.find((p) => p.kind === "trend_pullback_pullback").points
      .length,
  );
  assert.ok(
    figures.points.find((p) => p.kind === "trend_pullback_confirmation").points
      .length,
  );
});
test("confirmation cannot occur on the registration bar even when it breaks prior high", () => {
  const cfg = config({ TP_RSI_PERIOD: 5 });
  const state = createEngineState();
  // State at a later RSI crossing: prior losses permit RSI to fall while close rises.
  for (const c of history()) advanceEngine(state, cfg, c);
  state.rsi = 41;
  state.gain = { count: 5, value: 0.01 };
  state.loss = { count: 5, value: 2 };
  const r = advanceEngine(state, cfg, candle(50, 150));
  assert.equal(r.event, "PULLBACK_STARTED");
  assert.equal(r.signal, null);
});
test("pending expires after the inclusive deadline and persistent RSI does not rearm it", () => {
  const cfg = config({ TP_PENDING_BARS: 1 });
  const { state } = run([...history(), candle(50, 147)], cfg);
  assert.equal(
    advanceEngine(state, cfg, candle(51, 147)).event,
    "WAIT_CONFIRMATION",
  );
  assert.equal(
    advanceEngine(state, cfg, candle(52, 150)).event,
    "PENDING_EXPIRED",
  );
  assert.equal(state.pending, null);
  assert.equal(advanceEngine(state, cfg, candle(53, 151)).signal, null);
});
test("trend loss cancels pending before any price confirmation", () => {
  const cfg = config();
  const { state } = run([...history(), candle(50, 147)], cfg);
  assert.equal(advanceEngine(state, cfg, candle(51, 110)).event, "TREND_LOST");
  assert.equal(state.pending, null);
  assert.equal(advanceEngine(state, cfg, candle(52, 150)).signal, null);
});
test("gap cancels setup and rewarms trend instead of using stale direction", () => {
  const cfg = config();
  const { state } = run([...history(), candle(50, 147)], cfg);
  const r = advanceEngine(state, cfg, candle(52, 150));
  assert.equal(r.event, "DATA_GAP");
  assert.equal(r.signal, null);
  assert.equal(r.trend, null);
});
test("consumed setup needs RSI reset and a fresh crossing for re-entry", () => {
  const { state } = run(setup());
  assert.equal(state.pending, null);
  const first = advanceEngine(state, config(), candle(52, 151));
  assert.equal(first.signal, null);
  const next = advanceEngine(state, config(), candle(53, 148));
  assert.equal(next.event, "PULLBACK_STARTED");
  assert.ok(advanceEngine(state, config(), candle(54, 152)).signal);
});
test("occupied bars do not accumulate a later stale setup", () => {
  const cfg = config();
  const { state } = run(history());
  advanceEngine(state, cfg, candle(50, 147), true);
  assert.equal(state.pending, null);
  assert.equal(advanceEngine(state, cfg, candle(51, 150)).signal, null);
});
test("small stop is rejected and consumes the pending signal", () => {
  const { state, results } = run(setup(), config({ TP_MIN_STOP_ATR: 100 }));
  assert.equal(results.at(-1).event, "STOP_TOO_CLOSE");
  assert.equal(results.at(-1).signal, null);
  assert.equal(state.pending, null);
});
test("both trailing directions preserve initial risk under ATR expansion", () => {
  for (const direction of ["LONG", "SHORT"]) {
    const sign = direction === "LONG" ? 1 : -1;
    const trade = {
      direction,
      initialStop: 100 - sign * 5,
      stop: 100 - sign * 5,
      bestClose: 100,
    };
    for (const [close, atr] of [
      [102, 1],
      [104, 2],
      [103, 30],
      [110, 1],
    ]) {
      const old = trade.stop;
      advanceTrailingStop(
        trade,
        direction === "LONG" ? close : 200 - close,
        atr,
        3,
      );
      assert.ok(sign * (trade.stop - old) >= 0);
      assert.ok(sign * (trade.stop - trade.initialStop) >= 0);
    }
  }
});
test("state is bounded and rejects repeated/out-of-order/invalid candles", () => {
  const cfg = config({ TP_FIGURE_POINTS: 16 });
  const candles = Array.from({ length: 2000 }, (_, i) => candle(i, 100 + i));
  const { state } = run(candles, cfg);
  assert.ok(Object.values(state.series).every((series) => series.length <= 16));
  assert.ok(state.slowHistory.length <= cfg.TP_SLOPE_BARS + 1);
  assert.throws(() => advanceEngine(state, cfg, candles.at(-1)), /increasing/);
  assert.throws(() => advanceEngine(state, cfg, candle(2000, NaN)), /Invalid/);
});

test("first trend direction and a direction reversal cannot by themselves enter", () => {
  const cfg = config();
  const state = createEngineState();
  let prior = null;
  for (const c of [
    ...history(),
    ...Array.from({ length: 50 }, (_, j) => candle(50 + j, 145 - j)),
  ]) {
    const r = advanceEngine(state, cfg, c);
    if (r.trend !== prior) {
      assert.equal(r.signal, null);
      assert.notEqual(r.event, "PULLBACK_STARTED");
    }
    prior = r.trend;
  }
  assert.equal(state.trend, "SHORT");
});
test("unconfirmed intermediate candles and their wicks belong to the pullback", () => {
  const cfg = config();
  const { state } = run([...history(), candle(50, 147)], cfg);
  advanceEngine(state, cfg, candle(51, 147, HOUR, { low: 143 }));
  const r = advanceEngine(state, cfg, candle(52, 150));
  assert.equal(r.signal.extreme, 143);
  assert.equal(r.signal.extremeTimestamp, 51 * HOUR);
});
