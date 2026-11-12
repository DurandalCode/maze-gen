import {expect,test} from 'bun:test';
import {decodeDraft} from '../src/free/json';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {emptyLayout} from '../src/free/model';
const draft=()=>({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:10,rows:10,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'metadata'},construction:{...DEFAULT_CONSTRUCTION},layout:emptyLayout()});
const report={seed:'metadata',filledArea:0,blockedArea:0,outsideArea:0,regions:[]};
test('legacy drafts without optional reports remain readable; malformed nested display metadata is rejected before rendering',()=>{
 expect(()=>decodeDraft(JSON.stringify(draft()))).not.toThrow();for(const extra of [{baseGeometry:{}},{construction:{}},{baseGeometry:{modules:1,axisSpan:0,axisDirections:1,longestSide:3,connectionBend:{min:0,mean:0,max:0},gap:{min:3,mean:3,max:3,deviation:0},spanAudit:{audited:1,atMaximum:1,fallbacks:[{connection:'c',desired:3,actual:null}]}}}]){const d:any=draft();d.layout.cavityReport={...report,...extra};expect(()=>decodeDraft(JSON.stringify(d))).toThrow('отчёт');}
});
test('connection provenance audit rejects non-finite/malformed values and oversized reasons',()=>{for(const spanAudit of [{},{desired:3,actual:null},{desired:3,actual:2,reason:'x'.repeat(2001)}]){const d:any=draft();d.layout.connections=[{id:'c',a:{room:'a',edge:0,offset:0},b:{room:'b',edge:1,offset:0},width:1.4,spanAudit}];expect(()=>decodeDraft(JSON.stringify(d))).toThrow('аудит');}});
