import type { StrategyEntryModelFigures } from "@tradejs/types";
import type { EngineState } from "./engine.js";

/** Also accepts a restored state, so the final protection path can be inspected. */
export function buildTrendPullbackFigures(
  state: EngineState,
): StrategyEntryModelFigures {
  const colors = {
    fast: "#3b82f6",
    slow: "#8b5cf6",
    direction: "#64748b",
    extreme: "#f59e0b",
    stop: "#ef4444",
  };
  return {
    lines: Object.entries(colors)
      .map(([key, color]) => ({
        id: `trend-pullback-${key}`,
        kind: `trend_pullback_${key}`,
        color,
        points: state.series[key as keyof typeof colors].map((point) => ({
          ...point,
        })),
      }))
      .filter((line) => line.points.length > 0),
    points: ["pullback", "confirmation"].map((key) => ({
      id: `trend-pullback-${key}`,
      kind: `trend_pullback_${key}`,
      color: key === "pullback" ? "#f59e0b" : "#22c55e",
      radius: 5,
      points: state.series[key as "pullback" | "confirmation"].map((point) => ({
        ...point,
      })),
    })),
    annotations: state.last
      ? [
          {
            id: "trend-pullback-direction",
            kind: "trend_pullback_direction",
            point: { timestamp: state.last.timestamp, value: state.last.close },
            title: `TrendPullback: ${state.trend ?? "NEUTRAL"}`,
            items: [`RSI: ${state.rsi ?? "warmup"}`, `ATR: ${state.atr.value}`],
          },
        ]
      : [],
  };
}
