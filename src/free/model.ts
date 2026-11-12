import type {OrganicCharacter} from './organic-character';
import type { Environment } from '../core/environment';
import type { Construction, Parameters, Point, Wall } from '../core/maze';
export interface FreeModule { frameOnly?:boolean; zone?:string; id: string; type: '2x2' | '2x6' | 'custom'; x: number; z: number; angle: number; width?: number; depth?: number }
export interface FreeSpace { zone?:string; id: string; kind: 'hall' | 'corridor'; polygon: Point[]; holes?: Point[][] }
/** edge is clockwise from the local north edge; offset is metres from its midpoint. */
export interface Anchor { room: string; edge: number; offset: number }
export interface FreeOpening extends Anchor { id: string; width: number }
export interface FreeConnection {
 id:string;a:Anchor;b:Anchor;width:number;
 /** Optional placement provenance, never part of the physical topology ID. */
 spanAudit?:{desired:number;actual:number;reason?:string};
}
export interface FreeBridge extends FreeConnection {rise:number;stairRun:number}
export interface FreeZone {id:string;title:string;style:'branching'|'braided'|'winding'}
export interface CavityReport {construction?:{baseModules:number;addedModules:number;openedCourtyards:number;certifiedWalls:number};baseGeometry?:OrganicCharacter;seed:string;filledArea:number;blockedArea:number;outsideArea:number;regions:{id:string;area:number;filledArea:number;blockedArea:number;status:string;reason:string;cells:number;doors:number}[]}
export interface FreeLayout {
  /** Generated module-backed construction; old free-form/imported maps remain readable. */
  moduleConstruction?:{version:1;spans:FreeConnection[]};
  cavityReport?:CavityReport;
  zones?:FreeZone[];
  /** v7 maps: covered, reversible crossings with two stair flights. */
  bridges?:FreeBridge[];
  modules: FreeModule[]; spaces: FreeSpace[]; connections: FreeConnection[]; openings: FreeOpening[];
  entrance: string; exit: string; walls: (Wall & { id: string })[];
  /** Preserved physical panels when converting a legacy map. */
  preservedPanels?: Wall[];
  supports?: Point[];
  /** Authoritative imported uprights; panel segmentation must not add posts. */
  preservedSupports?: Point[];
}
export interface FreeDraft { environment?: Environment; kind: 'maze-lab-free-draft'; version: 1|2; parameters: Parameters; construction: Construction; layout: FreeLayout }
export interface FreeIssue { code: string; message: string; ids: string[] }
export const emptyLayout = (): FreeLayout => ({ modules: [], spaces: [], connections: [], openings: [], entrance: '', exit: '', walls: [] });
