import {expect,test} from 'bun:test';
import {emptyMaze,connect,type Maze} from '../src/core/maze';
import {compassProbe} from '../src/analysis/compass-probe';
function snake(){const m=emptyMaze({columns:3,rows:3,corridorWidth:2,algorithm:'prim',seed:'compass-control',extraConnections:0}),path=[0,1,2,5,4,3,6,7,8];for(let i=1;i<path.length;i++)connect(m,path[i-1]!,path[i]!);return m;}
function accounting(m:Maze){for(const r of compassProbe(m).runs){expect(Number.isFinite(r.length)).toBe(true);expect(r.ratio).toBeGreaterThanOrEqual(1);expect(r.length).toBeCloseTo(2*(r.visited+r.revisits),8);}}
test('control policies complete a forced route deterministically and account for physical travel',()=>{
 const m=snake(),before=structuredClone(m),p=compassProbe(m);expect(p.runs).toHaveLength(6);for(const r of p.runs)expect(r.length).toBe(18);expect(compassProbe(m)).toEqual(p);expect(m).toEqual(before);accounting(m);
});
test('a learned cycle shortcut reduces physical travel without cached stale topology',()=>{
 const m=snake();expect(compassProbe(m).runs[0]!.length).toBe(18);connect(m,5,8);for(const r of compassProbe(m).runs)expect(r.length).toBe(10);accounting(m);
});
test('fully visible blind side pockets do not require physical traversal',()=>{
 const m=emptyMaze({columns:7,rows:2,corridorWidth:2,algorithm:'prim',seed:'blind-control',extraConnections:0});for(let i=0;i<6;i++)connect(m,i,i+1);for(let i=0;i<7;i++)connect(m,i,i+7);m.exit={cell:6,side:'east'};
 for(const r of compassProbe(m).runs){expect(r.visited).toBe(7);expect(r.length).toBe(14);}accounting(m);
});
test('cyclic controls remain bounded and count revisited travel',()=>{
 const m=snake();connect(m,0,3);connect(m,1,4);connect(m,5,8);accounting(m);for(const r of compassProbe(m).runs)expect(r.visited).toBeLessThanOrEqual(9);
});
test('module spacing and single-cell endpoint travel are measured in metres',()=>{
 const m=emptyMaze({columns:3,rows:1,moduleSize:2,corridorWidth:1,algorithm:'prim',seed:'unequal-control',extraConnections:0});for(let i=0;i<4;i++)connect(m,i,i+1);for(const r of compassProbe(m).runs)expect(r.length).toBe(8);
 const one=emptyMaze({columns:1,rows:1,corridorWidth:2,algorithm:'prim',seed:'single-control',extraConnections:0});expect(compassProbe(one).bestRatio).toBe(1);
});
test('unreachable and oversized cases are explicitly unsupported',()=>{
 const m=emptyMaze({columns:2,rows:2,corridorWidth:2,algorithm:'prim',seed:'unreachable-control',extraConnections:0});expect(compassProbe(m).supported).toBe(false);
 const big=emptyMaze({...m.parameters,columns:100,rows:100});expect(compassProbe(big).supported).toBe(false);
});
