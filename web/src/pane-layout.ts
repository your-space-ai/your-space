import type { PaneLayout, ViewComposition } from "./workspace-layout.ts";

import { gridShape, maxPanes } from "../../workspace-layout/model.mjs";
export { gridShape, maxPanes };
const appName = /^[a-z][a-z0-9-]{0,29}$/;
const presets: PaneLayout[] = ["columns", "rows", "grid", "main"];
export type Sizes = ViewComposition["sizes"];
export type PaneSearch = { with?: string; layout?: PaneLayout; sizes?: string; view?: string };
type Cell = { row: number; column: number; rowSpan?: number; columnSpan?: number };

export function paneSearch(raw: Record<string, unknown>): PaneSearch {
  const search: PaneSearch = {};
  if (typeof raw.with === "string") {
    const withApps = [...new Set(raw.with.split(",").filter((name) => appName.test(name)))].slice(0, maxPanes - 1);
    if (withApps.length) search.with = withApps.join(",");
  }
  if (presets.includes(raw.layout as PaneLayout)) search.layout = raw.layout as PaneLayout;
  if (typeof raw.sizes === "string" && raw.sizes.length <= 400 && /^[\d.,/]+$/.test(raw.sizes))
    search.sizes = raw.sizes;
  if (typeof raw.view === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(raw.view))
    search.view = raw.view;
  return search;
}

export function cellsFor(layout: PaneLayout, count: number): Cell[] {
  const { columns, rows } = gridShape(layout, count);
  return Array.from({ length: count }, (_, index) => {
    if (layout === "main" && count > 1)
      return index === 0 ? { row: 0, column: 0, rowSpan: rows } : { row: index - 1, column: 1 };
    const column = index % columns;
    return { row: Math.floor(index / columns), column, columnSpan: index === count - 1 ? columns - column : 1 };
  });
}

export function dividersFor(cells: Cell[], columns: number, rows: number) {
  const lines: (
    | { type: "column"; column: number; rowSpan: number }
    | { type: "row"; row: number; column: number; columnSpan: number }
  )[] = [];
  for (let column = 1; column < columns; column++) {
    // Only the last row of a grid can span an internal column boundary.
    const across = cells.find((cell) => cell.column < column && cell.column + (cell.columnSpan ?? 1) > column);
    const rowSpan = across?.row ?? rows;
    if (rowSpan > 0) lines.push({ type: "column", column, rowSpan });
  }
  for (let row = 1; row < rows; row++) {
    // In Main with companions, the main app spans the left end of each row divider.
    const across = cells.find((cell) => cell.row < row && cell.row + (cell.rowSpan ?? 1) > row);
    const column = across ? across.column + (across.columnSpan ?? 1) : 0;
    if (column < columns) lines.push({ type: "row", row, column, columnSpan: columns - column });
  }
  return lines;
}

export function defaultSizes(layout: PaneLayout, count: number): Sizes {
  const { columns, rows } = gridShape(layout, count);
  return {
    columns: layout === "main" && count > 1 ? [65, 35] : Array(columns).fill(100 / columns),
    rows: Array(rows).fill(100 / rows),
  };
}

export function validSizes(value: unknown, layout: PaneLayout, count: number): value is Sizes {
  if (!value || typeof value !== "object") return false;
  const shape = gridShape(layout, count);
  return (["columns", "rows"] as const).every((axis) => {
    const sizes = (value as Sizes)[axis];
    return (
      Array.isArray(sizes) &&
      sizes.length === shape[axis] &&
      sizes.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 100) &&
      Math.abs(sizes.reduce((a, b) => a + b, 0) - 100) <= 0.1
    );
  });
}

export function encodeSizes(sizes: Sizes) {
  return [sizes.columns, sizes.rows].map((axis) => axis.map((n) => Number(n.toFixed(4))).join(",")).join("/");
}

export function decodeSizes(raw: string | undefined, layout: PaneLayout, count: number): Sizes | undefined {
  if (!raw) return;
  const pair = raw.split("/");
  if (pair.length !== 2) return;
  const sizes = { columns: pair[0]!.split(",").map(Number), rows: pair[1]!.split(",").map(Number) };
  return validSizes(sizes, layout, count) ? sizes : undefined;
}

export function compositionSearch(view: ViewComposition, viewId?: string): PaneSearch {
  return {
    with: view.apps.slice(1).join(",") || undefined,
    layout: view.layout,
    sizes: encodeSizes(view.sizes),
    view: viewId,
  };
}
