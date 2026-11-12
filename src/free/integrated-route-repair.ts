import type {Maze} from '../core/maze';
import type {RouteTraps} from '../analysis/route-traps';
import {mazeDraft} from './json';
import {freeMaze,freeRuntime} from './layout';
import {shortestPath} from '../core/pathfinding';
import {freeGroundLengths,freeGroundRunWitness,freeGroundStraightWitness} from './path-limits';
import {crosslinkLongRoute} from './route-crosslinks';
import {growCavityModules} from './cavity-module-growth';
import {sectorEnvelope} from './sector-envelope';

/** Repair with through-connections in a single native course beside the existing envelope. Never append
 * a terminal hall outside the layout merely to reset a corridor counter. */
export function repairIntegratedRoutes(source:Maze,baseline:ReadonlySet<string>,traps:RouteTraps,onProgress?:(s:string)=>void):Maze{
 let draft=mazeDraft(source);const initial=freeRuntime(source),protectedIds=[...new Set(traps.candidates.filter(t=>t.qualifies).flatMap(t=>[initial.rooms[t.fork]!.id,initial.rooms[t.correctAwayPath.at(-1)!]!.id]))];
 const forks=new Set(traps.candidates.filter(t=>t.qualifies).map(t=>initial.rooms[t.fork]!.id));
 const protectPeaks=new Set(traps.candidates.filter(t=>t.qualifies).map(t=>initial.rooms[t.correctAwayPath.at(-1)!]!.id));
 for(let pass=0;pass<6;pass++){
  const maze=freeMaze(draft,false),lengths=freeGroundLengths(maze,true);if(lengths.straight<=8+1e-7&&lengths.run<=16+1e-7)return maze;
  const straight=lengths.run<=16+1e-7,witness=(straight?freeGroundStraightWitness:freeGroundRunWitness)(maze,true),metric=straight?freeGroundStraightWitness:freeGroundRunWitness,ids=[...new Set(witness.rooms)];// Repair the first unresolved segment before consuming its interior pocket.
  // A downstream shortcut can otherwise occupy the only upstream closure.
  if(forks.has(ids.at(-1)!))ids.reverse();
  const roots=ids.filter(id=>!baseline.has(id)&&draft.layout.modules.some(m=>m.id===id));
  const direct=crosslinkLongRoute(draft,roots,straight,'integrated-link-'+pass,protectedIds);if(direct&&metric(freeMaze(direct,false),true).length<witness.length-1e-5){draft=direct;onProgress?.('Проход соединён с существующим сектором через настоящий модульный проём.');continue;}
  const adjacency=new Map<string,string[]>();for(const c of draft.layout.connections){adjacency.set(c.a.room,[...adjacency.get(c.a.room)??[],c.b.room]);adjacency.set(c.b.room,[...adjacency.get(c.b.room)??[],c.a.room]);}
  const canJoin=(a:string,b:string)=>protectedIds.every(skip=>{if(a===skip||b===skip)return true;const seen=new Set([a]),queue=[a];for(const at of queue)for(const n of adjacency.get(at)??[])if(n!==skip&&!seen.has(n)){seen.add(n);queue.push(n);}return seen.has(b);});
  const pairs=roots.slice(0,5).flatMap((root,rootIndex)=>{const a=draft.layout.modules.find(m=>m.id===root)!;return draft.layout.modules.filter(b=>{const d=Math.hypot(a.x-b.x,a.z-b.z);return b.id!==root&&d>=3.5&&d<=14&&canJoin(root,b.id);}).map(b=>({root,target:b.id,score:rootIndex*100+Math.hypot(a.x-b.x,a.z-b.z)-(protectPeaks.has(b.id)?30:baseline.has(b.id)?10:0)})).sort((a,b)=>a.score-b.score).slice(0,2);}).sort((a,b)=>a.score-b.score);
  let repaired=false;
  for(const [index,pair]of pairs.slice(0,4).entries()){
   const result=growCavityModules(draft,sectorEnvelope(draft,5),source.parameters.seed+'-integrating-repair-0-'+index,2,undefined,{root:pair.root,target:pair.target,deferLengthCheck:true,minimumNewModules:1,maxDepth:2,minimumGraphSeparation:1,diverse:true,lateral:true,maximumSpanFirst:true,targetApproachDistance:3,throughRoutes:true,acceptCandidate:d=>{
    const candidate=freeMaze(d,false),r=freeRuntime(candidate),route=new Set(shortestPath(candidate).map(i=>r.rooms[i]!.id));return protectedIds.every(id=>route.has(id))&&metric(candidate,true).length<=witness.length+1e-7;
   }});
   if(!result.addedModules)continue;draft=result.draft;
   const modules=new Set(draft.layout.modules.map(m=>m.id)),known=new Set(draft.layout.moduleConstruction!.spans.map(c=>c.id));for(const c of draft.layout.connections)if(modules.has(c.a.room)&&modules.has(c.b.room)&&!known.has(c.id)){draft.layout.moduleConstruction!.spans.push(structuredClone(c));known.add(c.id);}
   onProgress?.('Внутри пустоты замкнута дополнительная связь между существующими проходами.');repaired=true;break;
  }
  if(!repaired)throw Object.assign(Error('Не найден проход между существующими секторами для участка '+witness.length.toFixed(2)+'м; наружный тупиковый хвост не добавлен.'),{diagnosticDraft:draft});
 }
 const maze=freeMaze(draft,false),lengths=freeGroundLengths(maze,true);if(lengths.straight>8+1e-7||lengths.run>16+1e-7)throw Object.assign(Error('Шесть интегрирующих связей не завершили физические8/16.'),{diagnosticDraft:draft});return maze;
}
