import type { Board } from '../../design/types';

/** Boards in feeding order: each board is followed by the boards it feeds, indented. */
export function treeOrder(boards: Board[]): { board: Board; depth: number }[] {
  const ids = new Set(boards.map((b) => b.id));
  const out: { board: Board; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    boards
      .filter((b) => (parentId === null ? !b.parentId || !ids.has(b.parentId) : b.parentId === parentId))
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
      .forEach((b) => {
        out.push({ board: b, depth });
        walk(b.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

export const fmt = (n: number | null | undefined, digits = 2) => (n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits }));
