import type { Candle, Direction, StrategyFigurePoint } from "@tradejs/types";
import type { TrendPullbackConfig } from "./config.js";

export type Trend = Direction | null;
export interface PendingPullback {
  direction: Direction;
  timestamp: number;
  extreme: number;
  extremeTimestamp: number;
}
export interface PullbackSignal extends PendingPullback {
  confirmedAt: number;
  close: number;
  stop: number;
  atr: number;
}
interface Average {
  value: number;
  count: number;
}
export interface EngineState {
  version: 1;
  last: Candle | null;
  atr: Average;
  gain: Average;
  loss: Average;
  rsi: number | null;
  fast: number | null;
  slow: number | null;
  trendBars: number;
  slowHistory: number[];
  trend: Trend;
  hour: { start: number; count: number; close: number } | null;
  pending: PendingPullback | null;
  series: Record<
    | "fast"
    | "slow"
    | "direction"
    | "pullback"
    | "confirmation"
    | "extreme"
    | "stop",
    StrategyFigurePoint[]
  >;
}
export interface EngineResult {
  signal: PullbackSignal | null;
  event: string;
  trend: Trend;
  atr: number;
  rsi: number | null;
}
export const createEngineState = (): EngineState => ({
  version: 1,
  last: null,
  atr: { value: 0, count: 0 },
  gain: { value: 0, count: 0 },
  loss: { value: 0, count: 0 },
  rsi: null,
  fast: null,
  slow: null,
  trendBars: 0,
  slowHistory: [],
  trend: null,
  hour: null,
  pending: null,
  series: {
    fast: [],
    slow: [],
    direction: [],
    pullback: [],
    confirmation: [],
    extreme: [],
    stop: [],
  },
});
export const intervalMs = (config: TrendPullbackConfig) =>
  Number(config.INTERVAL) * 60000;
export function addPoint(
  state: EngineState,
  config: TrendPullbackConfig,
  key: keyof EngineState["series"],
  timestamp: number,
  value: number,
) {
  const series = state.series[key];
  series.push({ timestamp, value });
  if (series.length > config.TP_FIGURE_POINTS) series.shift();
}
function wilder(state: Average, value: number, period: number) {
  state.count = Math.min(state.count + 1, period);
  state.value += (value - state.value) / state.count;
}
function updateTrend(
  state: EngineState,
  config: TrendPullbackConfig,
  close: number,
) {
  state.fast =
    state.fast === null
      ? close
      : state.fast + (2 / (config.TP_FAST_EMA + 1)) * (close - state.fast);
  state.slow =
    state.slow === null
      ? close
      : state.slow + (2 / (config.TP_SLOW_EMA + 1)) * (close - state.slow);
  state.trendBars = Math.min(
    state.trendBars + 1,
    config.TP_SLOW_EMA + config.TP_SLOPE_BARS,
  );
  state.slowHistory.push(state.slow);
  if (state.slowHistory.length > config.TP_SLOPE_BARS + 1)
    state.slowHistory.shift();
  const old = state.slowHistory[0];
  state.trend =
    state.trendBars < config.TP_SLOW_EMA + config.TP_SLOPE_BARS
      ? null
      : state.fast > state.slow && state.slow > old
        ? "LONG"
        : state.fast < state.slow && state.slow < old
          ? "SHORT"
          : null;
}

/** Input timestamps are candle OPEN times; next() is called only after the candle closes. */
export function advanceEngine(
  state: EngineState,
  config: TrendPullbackConfig,
  candle: Candle,
  occupied = false,
): EngineResult {
  if (state.last && candle.timestamp <= state.last.timestamp)
    throw new Error(
      "TrendPullback requires strictly increasing closed candles",
    );
  const step = intervalMs(config);
  if (
    ![
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
    ].every(Number.isFinite) ||
    candle.low <= 0 ||
    candle.high < Math.max(candle.open, candle.close) ||
    candle.low > Math.min(candle.open, candle.close) ||
    candle.timestamp % step !== 0
  )
    throw new Error("Invalid TrendPullback candle");
  const gap =
    state.last !== null && candle.timestamp !== state.last.timestamp + step;
  const previous = state.last;
  const previousRsi = state.rsi;
  const previousTrend = state.trend;
  const tr = Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - (previous?.close ?? candle.close)),
    Math.abs(candle.low - (previous?.close ?? candle.close)),
  );
  wilder(state.atr, tr, config.TP_ATR_PERIOD);
  if (previous) {
    const delta = candle.close - previous.close;
    wilder(state.gain, Math.max(0, delta), config.TP_RSI_PERIOD);
    wilder(state.loss, Math.max(0, -delta), config.TP_RSI_PERIOD);
    if (state.gain.count >= config.TP_RSI_PERIOD) {
      const total = state.gain.value + state.loss.value;
      state.rsi = total === 0 ? 50 : (100 * state.gain.value) / total;
    }
  }
  if (gap) {
    // Never bridge a missing hour with stale EMA direction or a stale pending setup.
    state.fast = state.slow = null;
    state.trendBars = 0;
    state.slowHistory = [];
    state.trend = null;
    state.hour = null;
  }
  if (config.INTERVAL === "60") updateTrend(state, config, candle.close);
  else {
    const start = Math.floor(candle.timestamp / 3600000) * 3600000;
    if (candle.timestamp === start)
      state.hour = { start, count: 0, close: candle.close };
    const hour = state.hour;
    if (
      hour &&
      hour.start === start &&
      candle.timestamp === start + hour.count * step
    ) {
      hour.count++;
      hour.close = candle.close;
      if (hour.count === 4) {
        updateTrend(state, config, hour.close);
        state.hour = null;
      }
    } else state.hour = null;
  }
  let event = "WAIT_PULLBACK";
  let signal: PullbackSignal | null = null;
  const pending = state.pending;
  if (
    pending &&
    (gap ||
      state.trend !== pending.direction ||
      occupied ||
      candle.timestamp - pending.timestamp > config.TP_PENDING_BARS * step)
  ) {
    event = gap
      ? "DATA_GAP"
      : occupied
        ? "POSITION_EXISTS"
        : state.trend !== pending.direction
          ? "TREND_LOST"
          : "PENDING_EXPIRED";
    state.pending = null;
  } else if (pending) {
    const extreme = pending.direction === "LONG" ? candle.low : candle.high;
    if (
      pending.direction === "LONG"
        ? extreme < pending.extreme
        : extreme > pending.extreme
    ) {
      pending.extreme = extreme;
      pending.extremeTimestamp = candle.timestamp;
    }
    addPoint(state, config, "extreme", candle.timestamp, pending.extreme);
    const confirmed =
      previous &&
      candle.timestamp > pending.timestamp &&
      (pending.direction === "LONG"
        ? candle.close > previous.high
        : candle.close < previous.low);
    if (confirmed) {
      const side = pending.direction === "LONG" ? 1 : -1;
      const stop =
        pending.extreme - side * state.atr.value * config.TP_STOP_BUFFER_ATR;
      const distance = side * (candle.close - stop);
      if (
        stop > 0 &&
        distance >=
          Math.max(
            state.atr.value * config.TP_MIN_STOP_ATR,
            (candle.close * config.TP_MIN_STOP_PCT) / 100,
          )
      ) {
        signal = {
          ...pending,
          confirmedAt: candle.timestamp,
          close: candle.close,
          stop,
          atr: state.atr.value,
        };
        event = "CONFIRMED";
        addPoint(state, config, "confirmation", candle.timestamp, candle.close);
      } else event = "STOP_TOO_CLOSE";
      state.pending = null;
    } else event = "WAIT_CONFIRMATION";
  } else if (
    !occupied &&
    !gap &&
    state.trend &&
    state.trend === previousTrend &&
    previousRsi !== null &&
    state.rsi !== null &&
    state.atr.count >= config.TP_ATR_PERIOD
  ) {
    const crossed =
      state.trend === "LONG"
        ? previousRsi > config.TP_RSI_PULLBACK &&
          state.rsi <= config.TP_RSI_PULLBACK
        : previousRsi < 100 - config.TP_RSI_PULLBACK &&
          state.rsi >= 100 - config.TP_RSI_PULLBACK;
    if (crossed) {
      state.pending = {
        direction: state.trend,
        timestamp: candle.timestamp,
        extreme: state.trend === "LONG" ? candle.low : candle.high,
        extremeTimestamp: candle.timestamp,
      };
      event = "PULLBACK_STARTED";
      addPoint(state, config, "pullback", candle.timestamp, candle.close);
      addPoint(
        state,
        config,
        "extreme",
        candle.timestamp,
        state.pending.extreme,
      );
    }
  }
  if (state.fast !== null)
    addPoint(state, config, "fast", candle.timestamp, state.fast);
  if (state.slow !== null)
    addPoint(state, config, "slow", candle.timestamp, state.slow);
  if (state.trend)
    addPoint(state, config, "direction", candle.timestamp, candle.close);
  state.last = { ...candle };
  return {
    signal,
    event,
    trend: state.trend,
    atr: state.atr.value,
    rsi: state.rsi,
  };
}
