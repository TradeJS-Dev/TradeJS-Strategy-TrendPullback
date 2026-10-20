import { createStrategyAPI } from "@tradejs/core/strategies";
import { createTrendPullbackCore, parseConfig } from "../dist/index.js";
export const HOUR = 3600000;
export const candle = (i, close, step = HOUR, extra = {}) => ({
  timestamp: i * step,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 100,
  turnover: close * 100,
  dt: new Date(i * step).toISOString(),
  ...extra,
});
export const config = (extra = {}) =>
  parseConfig({
    TP_FAST_EMA: 10,
    TP_SLOW_EMA: 30,
    TP_SLOPE_BARS: 2,
    TP_RSI_PERIOD: 2,
    TP_ATR_PERIOD: 3,
    TP_PENDING_BARS: 3,
    ...extra,
  });
export const history = () =>
  Array.from({ length: 50 }, (_, i) => candle(i, 100 + i));
export const setup = () => [...history(), candle(50, 147), candle(51, 150)];
export const mirror = (c) => ({
  ...c,
  open: 400 - c.open,
  high: 400 - c.low,
  low: 400 - c.high,
  close: 400 - c.close,
});
export function harness(cfg = config(), data = [], saved = null) {
  let position = null;
  const current = [];
  const api = createStrategyAPI({
    strategy: "TrendPullback",
    symbol: "BTCUSDT",
    interval: cfg.INTERVAL,
    env: "BACKTEST",
    cachedData: current,
    connector: { getPosition: async () => position },
  });
  const realCreateState = api.createStateController;
  const controllers = [];
  api.createStateController = (...args) => {
    const controller = realCreateState(...args);
    if (saved) controller.set(structuredClone(saved));
    controllers.push(controller);
    return controller;
  };
  const core = createTrendPullbackCore({ config: cfg, data, strategyApi: api });
  return {
    next(c) {
      current.length = 0;
      current.push(c);
      return core(c, c);
    },
    setPosition(value) {
      position = value;
    },
    snapshot() {
      return controllers[0].snapshot();
    },
    async rebuild() {
      const rebuilt = createTrendPullbackCore({
        config: cfg,
        data,
        strategyApi: api,
      });
      return (c) => {
        current.length = 0;
        current.push(c);
        return rebuilt(c, c);
      };
    },
  };
}
