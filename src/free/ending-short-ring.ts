import type {Maze} from '../core/maze';
import type {FreeConnection,FreeModule} from './model';
import {mazeDraft} from './json';
import {freeMaze,validateFree,connectionGeometry} from './layout';
import {distance,ends} from './geometry';
import {auditModuleWalls} from './module-origin';

const from='hybrid-vortexhybridnext11spreadbay18-633',to='hybrid-vortexhybridnext11spreadbay18-1210';
/** Saved-map A/B experiment, not a replacement generator. Three real frames
 * carry a short return beside the existing finish, without moving its route. */
export function addEndingShortRing(source:Maze):Maze{
 if(!source.free?.moduleConstruction||!source.free.modules.some(m=>m.id==='f11-ending-final-turn'))throw Error('Нужна исходная карта с новым финальным поворотом.');
 if(source.free.modules.some(m=>m.id.startsWith('ending-short-ring-')))throw Error('Короткая концевая петля уже построена.');
 const root=source.free.modules.find(m=>m.id===from),target=source.free.modules.find(m=>m.id===to);if(!root||!target)throw Error('Нет двух исходных опор концовки.');
 const draft=mazeDraft(source),delta=root.angle-87.67773604147402,a=delta*Math.PI/180;
 const make=(i:number,dx:number,dz:number,angle:number):FreeModule=>({id:'ending-short-ring-'+i,type:'2x2',x:root.x+dx*Math.cos(a)-dz*Math.sin(a),z:root.z+dx*Math.sin(a)+dz*Math.cos(a),angle:angle+delta});
 const modules=[make(0,-3.14664997381637,-1.483441089479214,20),make(1,-6.49664997381637,-1.503441089479214,335),make(2,-4.19664997381637,.596558910520786,42)];
 const gate=(room:string,edge:number)=>({room,edge,offset:0}),width=1.6,connections:FreeConnection[]=[
  {id:'ending-short-ring-link-0',a:gate(from,2),b:gate(modules[0]!.id,1),width},
  {id:'ending-short-ring-link-1',a:gate(modules[0]!.id,3),b:gate(modules[1]!.id,1),width},
  {id:'ending-short-ring-link-2',a:gate(modules[1]!.id,2),b:gate(modules[2]!.id,3),width},
  {id:'ending-short-ring-link-3',a:gate(modules[2]!.id,1),b:gate(to,2),width},
 ];
 draft.layout.modules.push(...modules);draft.layout.connections.push(...connections);draft.layout.moduleConstruction!.spans.push(...structuredClone(connections));
 for(const c of connections){const g=connectionGeometry(draft.layout,c);c.spanAudit={desired:3,actual:Math.max(...g.sides.map(w=>distance(...ends(w))))};}
 const issues=validateFree(draft);if(issues.length)throw Object.assign(Error(issues.map(i=>i.code+':'+i.message+' ['+i.ids.join(',')+']').join('\n')),{diagnosticDraft:draft});
 const report=draft.layout.cavityReport;if(report?.construction){report.construction.addedModules+=modules.length;report.construction.certifiedWalls=auditModuleWalls(draft.layout).walls.length;report.regions.push({id:'ending-short-ring',area:0,filledArea:0,blockedArea:0,status:'filled',reason:'Локальная короткая возвратная петля: три настоящие2×2 рамы, исходная концовка и старые позы сохранены. Это не новая формальная К.',cells:3,doors:0});}
 return freeMaze(draft,false);
}
