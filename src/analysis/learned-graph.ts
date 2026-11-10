/** A route contains its starting cell and only openings observed during exploration. */
export interface LearnedRoute { cells: number[]; length: number }
export interface LearnedRoutes {
  distanceTo(cell: number): number;
  predecessorOf(cell: number): number | undefined;
  routeTo(cell: number): LearnedRoute | undefined;
}
/**
 * Episodic topology memory. The caller supplies openings only when standing in a
 * cell; this class has no access to a Maze or its hidden passages. Unentered cells
 * may be destinations, but never intermediate steps in a remembered return route.
 */
export class LearnedGraph {
  private readonly active: Uint8Array;
  private readonly entered: Uint8Array;
  private readonly adjacent: number[][];
  private readonly components: Int32Array;
  private cyclic = false;

  constructor(size: number, cells: readonly number[], private readonly length: (a: number, b: number) => number) {
    this.active = new Uint8Array(size);
    this.entered = new Uint8Array(size);
    this.adjacent = Array.from({ length: size }, () => []);
    this.components = new Int32Array(size).fill(-1);
    for (const cell of cells) { this.active[cell] = 1; this.components[cell] = cell; }
  }
  get hasCycles(): boolean { return this.cyclic; }
  neighbors(cell: number): readonly number[] { return this.adjacent[cell] ?? []; }
  private component(cell: number): number {
    let root = cell;
    while (this.components[root] !== root) root = this.components[root]!;
    while (cell !== root) { const next = this.components[cell]!; this.components[cell] = root; cell = next; }
    return root;
  }
  observe(cell: number, openings: readonly number[]): void {
    if (!this.active[cell]) throw new Error('Cannot observe an inactive cell.');
    this.entered[cell] = 1;
    for (const next of openings) {
      if (!this.active[next] || next === cell || this.adjacent[cell]!.includes(next)) continue;
      const length = this.length(cell, next);
      if (!Number.isFinite(length) || length <= 0) throw new Error('Invalid learned edge length.');
      this.adjacent[cell]!.push(next);
      this.adjacent[next]!.push(cell);
      const a = this.component(cell), b = this.component(next);
      if (a === b) this.cyclic = true; else this.components[b] = a;
    }
  }
  /** One Dijkstra supports the whole frontier shortlist and the chosen route. */
  routesFrom(source: number): LearnedRoutes {
    if (!this.entered[source]) throw new Error('Return routes must start in an observed cell.');
    const distances = new Float64Array(this.active.length).fill(Infinity);
    const previous = new Int32Array(this.active.length).fill(-1);
    const heap: { cell: number; distance: number }[] = [];
    const less = (a: {cell: number; distance: number}, b: {cell: number; distance: number}) => a.distance < b.distance || a.distance === b.distance && a.cell < b.cell;
    const push = (cell: number, distance: number) => {
      const entry = { cell, distance }; let i = heap.length; heap.push(entry);
      while (i > 0) { const p = (i - 1) >> 1; if (!less(entry, heap[p]!)) break; heap[i] = heap[p]!; i = p; }
      heap[i] = entry;
    };
    const pop = () => {
      const first = heap[0]!, last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (2 * i + 1 < heap.length) {
          let child = 2 * i + 1;
          if (child + 1 < heap.length && less(heap[child + 1]!, heap[child]!)) child++;
          if (!less(heap[child]!, last)) break;
          heap[i] = heap[child]!; i = child;
        }
        heap[i] = last;
      }
      return first;
    };
    distances[source] = 0; push(source, 0);
    while (heap.length) {
      const entry = pop();
      if (entry.distance !== distances[entry.cell] || !this.entered[entry.cell]) continue;
      for (const next of this.adjacent[entry.cell]!) {
        const candidate = entry.distance + this.length(entry.cell, next);
        if (candidate < distances[next]!) {
          distances[next] = candidate; previous[next] = entry.cell; push(next, candidate);
        }
      }
    }
    return {
      distanceTo: cell => distances[cell] ?? Infinity,
      predecessorOf: cell => previous[cell] === undefined || previous[cell] === -1 ? undefined : previous[cell],
      routeTo: cell => {
        if (!Number.isFinite(distances[cell])) return undefined;
        const cells = [cell];
        while (cells[cells.length - 1] !== source) cells.push(previous[cells[cells.length - 1]!]!);
        cells.reverse();
        return { cells, length: distances[cell]! };
      },
    };
  }
}
