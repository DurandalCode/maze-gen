import {test,expect} from 'bun:test';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {emptyLayout} from '../src/free/model';
import {freeMaze} from '../src/free/layout';
import {analyzeFree,freeHeatDisplay} from '../src/free/quality';
import {freeAreaWeights} from '../src/free/analysis-geometry';
test('the common heat display preserves the free-editor model and weights a cold branch by physical area',()=>{
 const l=emptyLayout();l.modules=[{id:'a',type:'2x2',x:10,z:10,angle:0},{id:'b',type:'2x2',x:14,z:10,angle:0},{id:'c',type:'2x2',x:10,z:14,angle:0}];
 l.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4},{id:'ac',a:{room:'a',edge:2,offset:0},b:{room:'c',edge:0,offset:0},width:1.4}];l.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'b',edge:1,offset:0,width:1.4}];l.entrance='in';l.exit='out';
 const m=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:24,rows:24,moduleSize:2,corridorWidth:2,extraConnections:0,seed:'free-display',algorithm:'backtracker'},construction:{...DEFAULT_CONSTRUCTION},layout:l}),o={...DEFAULT_ANALYSIS,profile:'explorer' as const,threshold:.8,samples:256},base=analyzeFree(m,o.samples,o.profile),display=freeHeatDisplay(m,o),weights=freeAreaWeights(m);
 expect(display.probability).toEqual(base.probability);expect(display.visits).toEqual(base.visits);expect(display.expectedLength).toBe(base.expectedLength);expect(display.regions.map(r=>r.cells)).toEqual([[2]]);expect(display.coldArea).toBeCloseTo(weights[2]!);expect(display.coldAreaRatio).toBeCloseTo(weights[2]!/weights.reduce((a,b)=>a+b,0));
 expect(freeHeatDisplay(m,{...o,threshold:.1}).regions).toEqual([]);
});
