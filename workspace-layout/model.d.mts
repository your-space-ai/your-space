export type PaneLayout = "columns" | "rows" | "grid" | "main";
export interface ViewComposition {
  layout: PaneLayout;
  apps: string[];
  sizes: { columns: number[]; rows: number[] };
}
export interface SavedView {
  id: string;
  name: string;
  revision: number;
  composition: ViewComposition;
}
export interface WorkspaceLayout {
  revision: number;
  appOrder: string[];
  views: SavedView[];
}
export const maxPanes: 12;
export function gridShape(layout: PaneLayout, count: number): { columns: number; rows: number };
export function validateComposition(value: unknown): ViewComposition;
