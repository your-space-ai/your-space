const layouts = new Set(["columns", "rows", "grid", "main"]);
export const maxPanes = 12;

export function gridShape(layout, count) {
  if (!layouts.has(layout) || !Number.isInteger(count) || count < 1 || count > maxPanes)
    throw new Error("Choose a supported layout and one to twelve apps.");
  if (layout === "columns") return { columns: count, rows: 1 };
  if (layout === "rows") return { columns: 1, rows: count };
  if (layout === "main") return { columns: count > 1 ? 2 : 1, rows: Math.max(1, count - 1) };
  const columns = Math.ceil(Math.sqrt(count));
  return { columns, rows: Math.ceil(count / columns) };
}

function fields(value, names) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  );
}

function validTracks(axis, count) {
  return (
    Array.isArray(axis) &&
    axis.length === count &&
    axis.every((n) => Number.isFinite(n) && n > 0 && n <= 100) &&
    Math.abs(axis.reduce((sum, n) => sum + n, 0) - 100) <= 0.10000001
  );
}

export function validateComposition(value) {
  if (
    !fields(value, ["layout", "apps", "sizes"]) ||
    !Array.isArray(value.apps) ||
    !value.apps.every((name) => typeof name === "string" && /^[a-z][a-z0-9-]{0,29}$/.test(name)) ||
    new Set(value.apps).size !== value.apps.length
  )
    throw new Error("Choose distinct installed apps.");
  const shape = gridShape(value.layout, value.apps.length);
  if (
    !fields(value.sizes, ["columns", "rows"]) ||
    !validTracks(value.sizes.columns, shape.columns) ||
    !validTracks(value.sizes.rows, shape.rows)
  ) {
    throw new Error("Pane sizes must match the layout and total 100 percent on each axis.");
  }
  return {
    layout: value.layout,
    apps: [...value.apps],
    sizes: { columns: [...value.sizes.columns], rows: [...value.sizes.rows] },
  };
}
