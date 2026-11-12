import {expect,test} from 'bun:test';
import {deserialize} from '../src/persistence/maze-json';
import {mazeDraft} from '../src/free/json';
import {denseTrapSites,squareFrameAssembly} from '../src/free/dense-second-trap';
import {growOrganicDenseSector} from '../src/free/organic-dense-sector';
import {connectionGeometry,validateFree} from '../src/free/layout';
import {distance,ends} from '../src/free/geometry';
import fixture from './fixtures/dense-one-trap-base.json';

test('organic sector uses individually turned through-frames instead of repeated row blocks',()=>{
 const source=deserialize(JSON.stringify(fixture)),d=mazeDraft(source),site=denseTrapSites(source)[0]!,old=JSON.stringify(source.free),parts=squareFrameAssembly(d,site.tail,'organic-sector-tail');
 for(const c of [{id:'organic-tail-door',a:{room:parts[1]!.id,edge:1,offset:0},b:{room:parts[2]!.id,edge:3,offset:0},width:1.4},{id:'organic-sector-door',a:{room:parts[1]!.id,edge:site.side,offset:0},b:site.join,width:1.4}]){d.layout.connections.push(c);d.layout.moduleConstruction!.spans.push(structuredClone(c));}
 const grown=growOrganicDenseSector(source,d,site.anchor,{room:parts[2]!.id,edge:1,offset:0}),added=grown.layout.modules.filter(m=>!d.layout.modules.some(b=>b.id===m.id));
 expect(added.length).toBeGreaterThanOrEqual(4);expect(new Set(added.map(m=>Math.round(m.angle%90))).size).toBeGreaterThanOrEqual(3);
 for(const m of added){const doors=grown.layout.connections.flatMap(c=>c.a.room===m.id?[c.a]:c.b.room===m.id?[c.b]:[]);expect(doors.length).toBe(2);expect(doors[0]!.edge).not.toBe(doors[1]!.edge);}
 for(const c of grown.layout.connections.filter(c=>added.some(m=>c.a.room===m.id||c.b.room===m.id)))expect(Math.max(...connectionGeometry(grown.layout,c).sides.map(w=>distance(...ends(w))))).toBeLessThanOrEqual(3+1e-7);
 expect(validateFree(grown).length).toBe(0);expect(JSON.stringify(source.free)).toBe(old);
},20000);
