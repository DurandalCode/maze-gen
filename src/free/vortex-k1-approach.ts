import type {Maze} from '../core/maze';
import type {FreeConnection,FreeModule} from './model';
import {mazeDraft} from './json';
import {freeMaze,validateFree} from './layout';
import {auditModuleWalls} from './module-origin';

/** Explicit A/B edit of the saved09/10 spiral family. This does not generate a
 * different maze or move the outer portals. The original remains untouched. */
export function k1OtherApproach(source:Maze):Maze {
 if(!source.free)throw Error('The K1 experiment requires a native free map.');
 const fork=source.free.modules.find(m=>m.id==='spiral1-16');
 if(!fork||Math.hypot(fork.x-50.26740525717756,fork.z-22.16828027534878)>1e-5||source.free.modules.some(m=>m.id.startsWith('k1-approach-')))throw Error('This A/B edit belongs to the unmodified saved09/10 spiral family.');
 const draft=mazeDraft(source),l=draft.layout,key=(a:string,b:string)=>[a,b].sort().join('|');
 const removed=new Set([['spiral1-17','spiral1-18'],['spiral2-11','spiral2-12'],['spiral3-3','spiral3-4'],['spiral3-5','spiral3-6'],['spiral3-6','spiral3-7'],['spiral3-3','spiral2-7'],['spiral3-4','spiral2-8']].map(([a,b])=>key(a!,b!)));
 if([...removed].some(pair=>!l.connections.some(c=>key(c.a.room,c.b.room)===pair)))throw Error('The saved map does not have the expected original K1 edges.');
 const shifted=new Set(['spiral3-3','spiral3-4']);
 for(const id of shifted){const current=l.modules.find(m=>m.id===id)!,expected=CHANGED_MODULES.find(m=>m.id===id)!;if(Math.hypot(current.x-expected.x,current.z-(expected.z+.45))>1e-5)throw Error('The K1 frames have already moved.');}
 l.modules=[...l.modules.filter(m=>!shifted.has(m.id)),...structuredClone(CHANGED_MODULES)];
 l.connections=[...l.connections.filter(c=>!removed.has(key(c.a.room,c.b.room))),...structuredClone(ADDED_CONNECTIONS)];
 // The unchanged courtyard polygons retain walls from the old native spans.
 // Keep those real module-backed origins; replace only spans of shifted frames.
 l.moduleConstruction!.spans=l.moduleConstruction!.spans.filter(c=>!shifted.has(c.a.room)&&!shifted.has(c.b.room));
 const modules=new Set(l.modules.map(m=>m.id)),certified=new Set(l.moduleConstruction!.spans.map(c=>c.id));
 l.moduleConstruction!.spans.push(...structuredClone(l.connections.filter(c=>modules.has(c.a.room)&&modules.has(c.b.room)&&!certified.has(c.id))));
 const issues=validateFree(draft);if(issues.length)throw Error('K1 A/B geometry: '+issues.map(i=>i.message).join(' '));
 const audit=auditModuleWalls(l);if(audit.issues.length)throw Error(audit.issues[0]!.message);
 if(l.cavityReport?.construction){l.cavityReport.construction.addedModules+=3;l.cavityReport.construction.certifiedWalls=audit.walls.length;}
 const result=freeMaze(draft,false);if(source.environment)result.environment=structuredClone(source.environment);return result;
}

const CHANGED_MODULES:FreeModule[]=[
 {"id":"spiral3-4","type":"2x2","x":38.49195082031157,"z":24.56293783782931,"angle":725.7389748543677},
 {"id":"spiral3-3","type":"2x2","x":33.96234857730923,"z":25.168906923191027,"angle":686.3865350388882},
 {"id":"k1-approach-outside","type":"2x6","x":56.2,"z":23.4,"angle":90},
 {"id":"k1-approach-correct","type":"2x2","x":47.38,"z":31.64,"angle":55.5},
 {"id":"k1-approach-return","type":"2x6","x":38.3,"z":26.7,"angle":0}
];
const ADDED_CONNECTIONS:FreeConnection[]=[
 {"id":"spiral3-4-door-1","a":{"room":"spiral3-4","edge":0,"offset":0.1},"b":{"room":"spiral2-8","edge":2,"offset":0},"width":1.8,"spanAudit":{"desired":3,"actual":1.392670423894991,"reason":"Индивидуальная ориентация реальной квадратной рамы."}},
 {"id":"spiral3-3-door-0","a":{"room":"spiral3-3","edge":1,"offset":0.3},"b":{"room":"spiral3-4","edge":3,"offset":0.1},"width":1.2,"spanAudit":{"desired":3,"actual":2.9983460995820095,"reason":"Индивидуальная ориентация реальной квадратной рамы."}},
 {"id":"k1-approach-outside-door-0","a":{"room":"k1-approach-outside","edge":1,"offset":0.3},"b":{"room":"spiral1-18","edge":3,"offset":0.3},"width":1.4,"spanAudit":{"desired":3,"actual":2.795394362213876,"reason":"Косой шестиметровый перекрёсток между двумя спиральными ветвями."}},
 {"id":"k1-approach-outside-door-1","a":{"room":"k1-approach-outside","edge":2,"offset":2.2},"b":{"room":"spiral0-23","edge":1,"offset":0.3},"width":1.4,"spanAudit":{"desired":3,"actual":2.927909141349844,"reason":"Косой шестиметровый перекрёсток между двумя спиральными ветвями."}},
 {"id":"k1-approach-correct-door-0","a":{"room":"k1-approach-correct","edge":0,"offset":-0.1},"b":{"room":"spiral2-11","edge":2,"offset":0},"width":1.8,"spanAudit":{"desired":3,"actual":2.6694828534151736,"reason":"Индивидуальная ориентация реальной квадратной рамы."}},
 {"id":"k1-approach-correct-door-1","a":{"room":"k1-approach-correct","edge":1,"offset":0},"b":{"room":"spiral3-7","edge":3,"offset":0},"width":2,"spanAudit":{"desired":3,"actual":0.6887190815113406,"reason":"Индивидуальная ориентация реальной квадратной рамы."}},
 {"id":"k1-approach-correct-door-2","a":{"room":"k1-approach-correct","edge":3,"offset":0.3},"b":{"room":"spiral3-6","edge":1,"offset":0.1},"width":1.4,"spanAudit":{"desired":3,"actual":0.33926317835551645,"reason":"Индивидуальная ориентация реальной квадратной рамы."}},
 {"id":"k1-approach-return-door-0","a":{"room":"k1-approach-return","edge":3,"offset":0.1},"b":{"room":"spiral3-3","edge":2,"offset":0.1},"width":1.8,"spanAudit":{"desired":3,"actual":1.8726203134978399,"reason":"Косой шестиметровый перекрёсток между двумя спиральными ветвями."}},
 {"id":"k1-approach-return-door-1","a":{"room":"k1-approach-return","edge":1,"offset":-0.3},"b":{"room":"spiral3-5","edge":3,"offset":-0.3},"width":1.4,"spanAudit":{"desired":3,"actual":0.9177796288285541,"reason":"Косой шестиметровый перекрёсток между двумя спиральными ветвями."}}
];
