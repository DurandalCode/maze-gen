import {expect,test} from 'bun:test';
import {generate} from '../src/generators/generate';
import {withPortals} from '../src/core/portals';
import {pRouteTrapMaze} from '../src/generators/p-route-trap';
import {routeTraps} from '../src/analysis/route-traps';
import {trapOverlay,trapDetailsAt} from '../src/ui/trap-overlay';
import {cellCenter} from '../src/core/maze';
import {domainOf} from '../src/core/domain';
function fixture(){const m=generate({columns:9,rows:9,moduleSize:2,corridorWidth:2,algorithm:'prim',seed:'overlay',extraConnections:0,shape:{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:9,height:9,operation:'add'},{x:3,z:3,width:3,height:6,operation:'subtract'}]}});const base=withPortals({...m,entrance:{cell:272,side:'south'},exit:{cell:288,side:'south'}},[{cell:272,side:'south'},{cell:288,side:'south'}]);return pRouteTrapMaze(base,'trap-proof')!;}
test('overlay displays the exact qualified branches and initial correct retreat from assessment',()=>{
 const maze=fixture(),analysis=routeTraps(maze),snapshot=structuredClone(analysis),entries=trapOverlay(maze,analysis);
 expect(entries.length).toBe(analysis.qualifiedCount);expect(entries.length).toBeGreaterThan(0);
 for(const entry of entries){
   expect(entry.label).toMatch(/^Л\d+$/);expect(entry.point).toEqual(cellCenter(maze,entry.fork));
   for(const member of entry.members){expect(member.qualifies).toBe(true);for(const c of [...member.falsePath,...member.correctAwayPath])expect(domainOf(maze).active[c]).toBe(1);expect(entry.falsePaths).toContainEqual(member.falsePath.map(c=>cellCenter(maze,c)));}
   expect(entry.awayPath).toEqual(entry.members[0]!.correctAwayPath.map(c=>cellCenter(maze,c)));
   expect(entry.awayPath).not.toContainEqual(cellCenter(maze,maze.exit.cell));
 }
 expect(analysis).toEqual(snapshot);expect(trapOverlay(maze,analysis)).toEqual(entries);
});
test('one fork is labelled once even if several qualified routes share it, and failed candidates stay hidden',()=>{
 const maze=fixture(),analysis=routeTraps(maze),member=analysis.candidates.find(t=>t.qualifies)!;
 const entries=trapOverlay(maze,{...analysis,candidates:[member,structuredClone(member),{...member,fork:maze.entrance.cell,qualifies:false}]});
 expect(entries).toHaveLength(1);expect(entries[0]!.members).toHaveLength(1);expect(entries[0]!.falsePaths).toHaveLength(1);
});
test('hover identifies each role and unrelated cells do not acquire a trap label',()=>{
 const maze=fixture(),entries=trapOverlay(maze),entry=entries[0]!,t=entry.members[0]!;
 expect(trapDetailsAt(entries,t.fork).join()).toContain('развилка');
 expect(trapDetailsAt(entries,t.deadEnd).join()).toContain('тупик');
 expect(trapDetailsAt(entries,t.falsePath[1]!).join()).toContain('ложное продвижение');
 expect(trapDetailsAt(entries,t.correctAwayPath[1]!).join()).toContain('начальное удаление');
 expect(trapDetailsAt(entries,-1)).toEqual([]);
 const cyclic=generate({columns:4,rows:4,corridorWidth:2,algorithm:'prim',seed:'cycle',extraConnections:1});
 expect(trapOverlay(cyclic)).toEqual([]);
});
