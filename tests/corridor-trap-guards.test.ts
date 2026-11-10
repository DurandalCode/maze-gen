import {expect,test} from 'bun:test';
import {bridgeGuard,branchComponent,guardedConnection,routeBranchGuards,type BranchGuard} from '../src/generators/corridor-trap-guards';
test('ordinary connections cannot provide an escape or third door to a reserved return loop',()=>{
 const guard:BranchGuard={fork:2,cells:new Set([5,6,7]),kind:'loop'};
 for(const edge of [{a:5,b:3},{a:6,b:4},{a:2,b:6}])expect(guardedConnection(edge,[guard])).toBe(false);
 expect(guardedConnection({a:5,b:7},[guard])).toBe(true);
 expect(guardedConnection({a:0,b:4},[guard])).toBe(true);
 const links=[[1],[0,2],[1,3,5,7],[2,4],[3],[2,6],[5,7],[6,2]];
 expect([...branchComponent(links,5,2)].sort()).toEqual([5,6,7]);
});
test('direction-reversing route forks reserve their promising blind tree without inventing a trap qualification',()=>{
 const nodes=[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:30,z:10},{x:30,z:0},{x:20,z:0},{x:26,z:0}];
 const links=[[1],[0,2,5],[1,3],[2,4],[3],[1,6],[5]];
 const guards=routeBranchGuards(nodes,links,[0,1,2,3,4],1);
 // This route initially retreats only 2.36 m, below the 8 m physical criterion.
 expect(guards).toHaveLength(0);
 const modified=nodes.map(p=>({...p}));modified[2]={x:0,z:10};
 const selected=routeBranchGuards(modified,links,[0,1,2,3,4],1);
 expect(selected).toHaveLength(1);expect(selected[0]!.fork).toBe(1);
 expect([...selected[0]!.cells].sort()).toEqual([5,6]);
 expect(guardedConnection({a:5,b:6},selected)).toBe(false);
 expect(guardedConnection({a:6,b:4},selected)).toBe(false);
 expect(guardedConnection({a:0,b:3},selected)).toBe(true);
 expect(routeBranchGuards(modified,links,[0,1,2,3,4],0)).toEqual([]);
});

test('the correct retreat and return-loop fork cannot be bypassed by an ordinary shortcut',()=>{
 const links=[[1],[0,2,4],[1,3],[2],[1]],guard=bridgeGuard(links,1,2);
 expect(guardedConnection({a:0,b:3},[guard])).toBe(false);
 expect(guardedConnection({a:4,b:2},[guard])).toBe(false);
 expect(guardedConnection({a:0,b:4},[guard])).toBe(true);
 expect(guardedConnection({a:2,b:3},[guard])).toBe(true);
});
