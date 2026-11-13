import type {Maze} from '../core/maze';
import type {FreeConnection} from './model';
import {mazeDraft} from './json';
import {freeMaze,validateFree} from './layout';
/** Explicit local A/B edit of saved F11. No original frame, courtyard or
 * external portal moves. The former direct exit branch becomes a false lead. */
export function vortexF11Ending(source:Maze):Maze{
 if(!source.free||source.free.modules.some(m=>m.id==='f11-ending-final-turn'))throw Error('Expected the original saved F11 map.');
 const d=mazeDraft(source),l=d.layout,old=l.connections.find(c=>[c.a.room,c.b.room].includes('spiral0-16')&&[c.a.room,c.b.room].includes('spiral3-23'));
 if(!old||!l.modules.some(m=>m.id==='hybrid-vortexhybridnext11spreadbay19-1162'))throw Error('The original F11 ending is missing.');
 l.connections=l.connections.filter(c=>c.id!==old.id);
 l.modules.push({id:'f11-ending-final-turn',type:'2x2',x:22.9,z:14.5,angle:45});
 l.connections.push(...structuredClone(CONNECTIONS));l.moduleConstruction!.spans.push(...structuredClone(CONNECTIONS));
 const issues=validateFree(d);if(issues.length)throw Error(issues.map(i=>i.message).join(' '));
 const result=freeMaze(d,false);if(source.environment)result.environment=structuredClone(source.environment);return result;
}
const CONNECTIONS:FreeConnection[]=[
 {"id":"f11-ending-final-turn-0","a":{"room":"f11-ending-final-turn","edge":1,"offset":0.3},"b":{"room":"hybrid-vortexhybridnext11spreadbay19-1162","edge":3,"offset":0.3},"width":1.4,"spanAudit":{"desired":3,"actual":1.5567292865235665,"reason":"Выборочный переход между существующими спиральными рамами; пролёт ограничен их настоящими гранями."}},
 {"id":"f11-ending-final-turn-1","a":{"room":"f11-ending-final-turn","edge":2,"offset":0.3},"b":{"room":"spiral3-23","edge":1,"offset":-0.18},"width":1.4,"spanAudit":{"desired":3,"actual":2.966407078901778,"reason":"Выборочный переход между существующими спиральными рамами; пролёт ограничен их настоящими гранями."}}
];
