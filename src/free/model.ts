import type { Environment } from '../core/environment';
import type { Construction, Parameters, Point, Wall } from '../core/maze';
export interface FreeModule { id: string; type: '2x2' | '2x6' | 'custom'; x: number; z: number; angle: number; width?: number; depth?: number }
export interface FreeSpace { id: string; kind: 'hall' | 'corridor'; polygon: Point[]; holes?: Point[][] }
/** edge is clockwise from the local north edge; offset is metres from its midpoint. */
export interface Anchor { room: string; edge: number; offset: number }
export interface FreeOpening extends Anchor { id: string; width: number }
export interface FreeConnection { id: string; a: Anchor; b: Anchor; width: number }
export interface FreeBridge extends FreeConnection {rise:number;stairRun:number}
export interface FreeLayout {
  /** v7 maps: covered, reversible crossings with two stair flights. */
  bridges?:FreeBridge[];
  modules: FreeModule[]; spaces: FreeSpace[]; connections: FreeConnection[]; openings: FreeOpening[];
  entrance: string; exit: string; walls: (Wall & { id: string })[];
  /** Preserved physical panels when converting a legacy map. */
  preservedPanels?: Wall[];
  supports?: Point[];
}
export interface FreeDraft { environment?: Environment; kind: 'maze-lab-free-draft'; version: 1|2; parameters: Parameters; construction: Construction; layout: FreeLayout }
export interface FreeIssue { code: string; message: string; ids: string[] }
export const emptyLayout = (): FreeLayout => ({ modules: [], spaces: [], connections: [], openings: [], entrance: '', exit: '', walls: [] });
