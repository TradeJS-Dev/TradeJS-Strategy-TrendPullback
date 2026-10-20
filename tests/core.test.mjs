import assert from "node:assert/strict";
import test from "node:test";
import {
  harness,
  config,
  candle,
  setup,
  history,
  mirror,
  HOUR,
} from "./helpers.mjs";

async function entered(cfg = config(), candles = setup()) {
  const h = harness(cfg);
  let decision;
  for (const c of candles) decision = await h.next(c);
  assert.equal(decision.kind, "entry");
  h.setPosition({
    symbol: "BTCUSDT",
    direction: decision.entryContext.direction,
    price: candles.at(-1).close,
    qty: decision.orderPlan.qty,
    slPrice: decision.orderPlan.stopLossPrice,
  });
  return { h, decision };
}
test("real StrategyAPI creates a sized open intent with stop, target and figures", async () => {
  const { h, decision } = await entered();
  assert.equal(decision.orderPlan.positionIntent, "open");
  assert.equal(decision.orderPlan.takeProfits.length, 1);
  assert.ok(decision.orderPlan.qty > 0);
  assert.ok(
    decision.orderPlan.qty * (150 - decision.orderPlan.stopLossPrice) < 10,
  );
  assert.equal(decision.entryContext.timestamp, 51 * HOUR);
  assert.ok(decision.signal.figures.lines.length > 0);
  const protect = await h.next(candle(52, 151));
  assert.equal(protect.kind, "protect");
  assert.ok(
    protect.protectPlan.stopLossPrice >= decision.orderPlan.stopLossPrice,
  );
  assert.equal(h.snapshot().engine.pending, null);
});
test("active position cannot be increased and both directions trail monotonically", async () => {
  for (const short of [false, true]) {
    const { h, decision } = await entered(
      config(),
      short ? setup().map(mirror) : setup(),
    );
    let stop = decision.orderPlan.stopLossPrice;
    for (let i = 52; i < 60; i++) {
      const c = candle(i, 151 + i - 52);
      const d = await h.next(short ? mirror(c) : c);
      assert.equal(d.kind, "protect");
      assert.ok(
        short
          ? d.protectPlan.stopLossPrice <= stop
          : d.protectPlan.stopLossPrice >= stop,
      );
      stop = d.protectPlan.stopLossPrice;
    }
  }
});
test("stop crossing exits through StrategyAPI using current decision price", async () => {
  const { h, decision } = await entered();
  const c = candle(52, decision.orderPlan.stopLossPrice - 1);
  const d = await h.next(c);
  assert.equal(d.kind, "exit");
  assert.equal(d.code, "TP_STOP_CROSSED");
  assert.equal(d.closePlan.timestamp, c.timestamp);
  assert.equal(d.closePlan.price, c.close);
});
test("lost trend exits even when the initial stop has not been crossed", async () => {
  const { h } = await entered(config({ TP_STOP_BUFFER_ATR: 20 }));
  const d = await h.next(candle(52, 110));
  assert.equal(d.code, "TP_TREND_LOST");
});
test("holding deadline is elapsed time, including the first occupied bar", async () => {
  const { h } = await entered(config({ TP_MAX_HOLD_HOURS: 1 }));
  assert.equal((await h.next(candle(52, 151))).code, "TP_MAX_HOLD");
});
test("rejected entry and an already closed position do not block a fresh pullback", async () => {
  const h = harness();
  for (const c of setup()) await h.next(c);
  assert.equal((await h.next(candle(52, 151))).kind, "skip");
  assert.equal(h.snapshot().trade, null);
  await h.next(candle(53, 148));
  assert.equal((await h.next(candle(54, 152))).kind, "entry");
});
test("runtime reconstruction and duplicate timestamp preserve the exact decision", async () => {
  const h = harness();
  for (const c of history()) await h.next(c);
  const c = candle(50, 147);
  const a = await h.next(c);
  const snapshot = h.snapshot();
  const again = await h.next(c);
  assert.deepEqual(again, a);
  assert.deepEqual(h.snapshot(), snapshot);
  const rebuilt = await h.rebuild();
  assert.equal((await rebuilt(candle(51, 150), candle(51, 150))).kind, "entry");
});
test("JSON checkpoint resumes pending setup and open-position trail exactly", async () => {
  const pending = harness();
  for (const c of [...history(), candle(50, 147)]) await pending.next(c);
  const checkpoint = JSON.parse(JSON.stringify(pending.snapshot()));
  const restored = harness(config(), [], checkpoint);
  assert.deepEqual(
    await restored.next(candle(51, 150)),
    await pending.next(candle(51, 150)),
  );
  const { h, decision } = await entered();
  await h.next(candle(52, 155));
  const pos = {
    symbol: "BTCUSDT",
    direction: "LONG",
    price: 150,
    qty: decision.orderPlan.qty,
    slPrice: decision.orderPlan.stopLossPrice,
  };
  const h2 = harness(config(), [], JSON.parse(JSON.stringify(h.snapshot())));
  h2.setPosition(pos);
  assert.deepEqual(
    await h2.next(candle(53, 156)),
    await h.next(candle(53, 156)),
  );
  assert.deepEqual(h2.snapshot(), h.snapshot());
});
test("position without checkpoint and externally increased position exit explicitly", async () => {
  const h = harness(config(), history());
  h.setPosition({ symbol: "BTCUSDT", direction: "LONG", price: 150, qty: 1 });
  assert.equal((await h.next(candle(50, 150))).code, "TP_UNTRACKED_POSITION");
  const enteredPosition = await entered();
  await enteredPosition.h.next(candle(52, 151));
  enteredPosition.h.setPosition({
    symbol: "BTCUSDT",
    direction: "LONG",
    price: 150,
    qty: 999,
  });
  assert.equal(
    (await enteredPosition.h.next(candle(53, 152))).code,
    "TP_POSITION_CHANGED",
  );
});
test("a tighter exchange stop is preserved", async () => {
  const { h, decision } = await entered();
  h.setPosition({
    symbol: "BTCUSDT",
    direction: "LONG",
    price: 150,
    qty: decision.orderPlan.qty,
    slPrice: 150,
  });
  const d = await h.next(candle(52, 151));
  assert.ok(d.protectPlan.stopLossPrice >= 150);
});

test("restored checkpoint is idempotent on its last candle and bound to config", async () => {
  const { h, decision } = await entered();
  const checkpoint = JSON.parse(JSON.stringify(h.snapshot()));
  const restored = harness(config(), [], checkpoint);
  assert.deepEqual(
    await restored.next(candle(51, 150)),
    JSON.parse(JSON.stringify(decision)),
  );
  assert.deepEqual(restored.snapshot(), checkpoint);
  const wrong = harness(config({ TP_TRAIL_ATR: 4 }), [], checkpoint);
  await assert.rejects(wrong.next(candle(52, 151)), /config mismatch/);
});
test("disabled direction consumes a setup without entry", async () => {
  const h = harness(config({ LONG: { enable: false } }));
  let d;
  for (const c of setup()) d = await h.next(c);
  assert.equal(d.code, "TP_DISABLED");
  assert.equal(h.snapshot().trade, null);
  assert.equal(h.snapshot().engine.pending, null);
});
test("figures reconstruct the actual stop movement after protection", async () => {
  const { buildTrendPullbackFigures } = await import("../dist/index.js");
  const { h } = await entered();
  await h.next(candle(52, 155));
  await h.next(candle(53, 157));
  const snapshot = h.snapshot();
  const path = buildTrendPullbackFigures(snapshot.engine).lines.find(
    (line) => line.kind === "trend_pullback_stop",
  );
  assert.equal(path.points.length, 3);
  assert.equal(path.points.at(-1).value, snapshot.trade.stop);
  assert.ok(
    path.points.every((p, i) => i === 0 || p.value >= path.points[i - 1].value),
  );
});
