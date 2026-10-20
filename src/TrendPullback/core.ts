import type {
  Candle,
  CreateStrategyCore,
  Direction,
  StrategyDecision,
} from "@tradejs/types";
import { buildStructureRiskPlan } from "@tradejs/strategy-kit/risk";
import { parseConfig } from "./config.js";
import type { TrendPullbackConfig } from "./config.js";
import {
  addPoint,
  advanceEngine,
  createEngineState,
  intervalMs,
} from "./engine.js";
import type { EngineState } from "./engine.js";
import { buildTrendPullbackFigures } from "./figures.js";

export interface TradeState {
  direction: Direction;
  openedAt: number;
  initialStop: number;
  stop: number;
  bestClose: number;
  observed: boolean;
  fillPrice: number | null;
  qty: number | null;
}
export interface TrendPullbackState {
  version: 1;
  initialized: boolean;
  configKey: string | null;
  lastDecision: StrategyDecision | null;
  engine: EngineState;
  trade: TradeState | null;
}
export const createTrendPullbackState = (): TrendPullbackState => ({
  version: 1,
  initialized: false,
  configKey: null,
  lastDecision: null,
  engine: createEngineState(),
  trade: null,
});

export function advanceTrailingStop(
  trade: TradeState,
  close: number,
  atr: number,
  mult: number,
): number {
  if (trade.direction === "LONG") {
    trade.bestClose = Math.max(trade.bestClose, close);
    trade.stop = Math.max(
      trade.initialStop,
      trade.stop,
      trade.bestClose - atr * mult,
    );
  } else {
    trade.bestClose = Math.min(trade.bestClose, close);
    trade.stop = Math.min(
      trade.initialStop,
      trade.stop,
      trade.bestClose + atr * mult,
    );
  }
  return trade.stop;
}

export const createTrendPullbackCore: CreateStrategyCore<
  TrendPullbackConfig
> = ({ config: input, data, strategyApi }) => {
  const config = parseConfig(input);
  const controller = strategyApi.createStateController<
    TrendPullbackState,
    Promise<StrategyDecision>
  >("TrendPullback", createTrendPullbackState, {
    configKey: JSON.stringify(config),
    snapshot: (state) => structuredClone(state),
  });
  const evaluate = async (
    candle: Candle,
    state: TrendPullbackState,
  ): Promise<StrategyDecision> => {
    const position = await strategyApi.getCurrentPosition();
    const occupied = Boolean(position && position.qty > 0);
    if (!state.initialized) {
      // Runtime may supply the whole backtest array. Never initialize from future bars.
      for (const previous of data) {
        if (previous.timestamp < candle.timestamp)
          advanceEngine(state.engine, config, previous);
      }
      state.initialized = true;
    }
    const result = advanceEngine(state.engine, config, candle, occupied);
    if (occupied && position) {
      const trade = state.trade;
      const exit = (code: string) =>
        strategyApi.exit({ direction: position.direction, code });
      // An exchange position alone cannot recover its initial risk or holding clock.
      if (!trade || trade.direction !== position.direction)
        return exit("TP_UNTRACKED_POSITION");
      if (
        trade.observed &&
        (trade.fillPrice !== position.price || trade.qty !== position.qty)
      )
        return exit("TP_POSITION_CHANGED");
      trade.observed = true;
      trade.fillPrice = position.price;
      trade.qty = position.qty;
      const side = trade.direction === "LONG" ? 1 : -1;
      if (side * (candle.close - trade.stop) <= 0)
        return exit("TP_STOP_CROSSED");
      if (result.trend !== trade.direction) return exit("TP_TREND_LOST");
      if (
        candle.timestamp + intervalMs(config) - trade.openedAt >=
        config.TP_MAX_HOLD_HOURS * 3600000
      )
        return exit("TP_MAX_HOLD");
      // Preserve a tighter exchange stop after recovery, too.
      if (position.slPrice && Number.isFinite(position.slPrice)) {
        trade.stop =
          side === 1
            ? Math.max(trade.stop, position.slPrice)
            : Math.min(trade.stop, position.slPrice);
      }
      const stop = advanceTrailingStop(
        trade,
        candle.close,
        result.atr,
        config.TP_TRAIL_ATR,
      );
      addPoint(state.engine, config, "stop", candle.timestamp, stop);
      if (side * (candle.close - stop) <= 0) return exit("TP_STOP_CROSSED");
      return strategyApi.protect({
        code: "TP_ATR_TRAIL",
        protectPlan: { direction: trade.direction, stopLossPrice: stop },
      });
    }
    // Entry decisions can be rejected by runtime or an order can already have closed.
    // A consumed pullback is never reissued; only a fresh RSI crossing may re-enter.
    state.trade = null;
    const signal = result.signal;
    if (!signal) return strategyApi.skip(`TP_${result.event}`);
    if (!config.ENABLE || !config[signal.direction].enable)
      return strategyApi.skip("TP_DISABLED");
    const { currentPrice, timestamp } =
      await strategyApi.getDecisionPriceContext();
    const side = signal.direction === "LONG" ? 1 : -1;
    const distance = side * (currentPrice - signal.stop);
    if (
      distance <
      Math.max(
        result.atr * config.TP_MIN_STOP_ATR,
        (currentPrice * config.TP_MIN_STOP_PCT) / 100,
      )
    )
      return strategyApi.skip("TP_STOP_TOO_CLOSE");
    const plan = buildStructureRiskPlan({
      currentPrice,
      direction: signal.direction,
      stopLossPrice: signal.stop,
      targetR: config.TP_TARGET_R,
      maxLossValue: config.MAX_LOSS_VALUE,
      feeRate: config.RISK_FEE_RATE,
      slippageBps: config.RISK_SLIPPAGE_BPS + config.RISK_MARKET_IMPACT_BPS,
    });
    if (
      !Number.isFinite(plan.qty) ||
      plan.qty <= 0 ||
      !Number.isFinite(plan.takeProfitPrice) ||
      plan.takeProfitPrice <= 0
    )
      return strategyApi.skip("TP_INVALID_RISK_PLAN");
    state.trade = {
      direction: signal.direction,
      openedAt: timestamp + intervalMs(config),
      initialStop: signal.stop,
      stop: signal.stop,
      bestClose: currentPrice,
      observed: false,
      fillPrice: null,
      qty: null,
    };
    state.engine.series.stop = [];
    addPoint(state.engine, config, "stop", timestamp, signal.stop);
    return strategyApi.entry({
      code: "TP_PULLBACK_CONFIRMED",
      direction: signal.direction,
      signalId: `TrendPullback:${signal.direction}:${signal.timestamp}:${timestamp}`,
      additionalIndicators: {
        trendPullback: { ...signal, trend: result.trend, rsi: result.rsi },
      },
      figures: buildTrendPullbackFigures(state.engine),
      orderPlan: {
        qty: plan.qty,
        stopLossPrice: signal.stop,
        takeProfits: [{ price: plan.takeProfitPrice, rate: 1 }],
        positionIntent: "open",
      },
    });
  };
  return (candle) =>
    controller.oncePerTimestamp(candle.timestamp, async (state) => {
      if (state.version !== 1 || state.engine.version !== 1)
        throw new Error("Unsupported TrendPullback checkpoint");
      const configKey = JSON.stringify(config);
      if (state.configKey !== null && state.configKey !== configKey)
        throw new Error("TrendPullback checkpoint config mismatch");
      state.configKey = configKey;
      if (
        state.engine.last?.timestamp === candle.timestamp &&
        state.lastDecision
      )
        return structuredClone(state.lastDecision);
      const decision = await evaluate(candle, state);
      state.lastDecision = structuredClone(decision);
      return decision;
    });
};
