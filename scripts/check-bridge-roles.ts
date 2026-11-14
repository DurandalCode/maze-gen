/** Graph evidence for distinct bridge roles; its output contains design spoilers. */
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {deserialize} from '../src/persistence/maze-json';
import {freeRuntime,freeGraphPath} from '../src/free/layout';
import {bridgeGeometry} from '../src/free/bridges';
import {loopTraps} from '../src/analysis/loop-traps';
import {pathLength,shortestPath} from '../src/core/pathfinding';
import {componentCount} from '../src/core/graph';
const file=Bun.argv[2];if(!file)throw Error('Usage: bun scripts/check-bridge-roles.ts revision02.json');
const raw=await Bun.file(file).text(),maze=deserialize(raw),r=freeRuntime(maze),bridges=maze.free!.bridges!;
const index=(room:string)=>r.rooms.findIndex(v=>v.id===room),route=shortestPath(maze),loops=loopTraps(maze).candidates.filter(t=>t.qualifies);
const roles=bridges.map(b=>{
 const a=index(b.a.room),z=index(b.b.room),cut={...maze,passages:maze.passages.map((n,i)=>n.filter(j=>!(i===a&&j===z||i===z&&j===a)))},componentsWithout=componentCount(cut);
 const onMain=route.slice(1).some((n,i)=>route[i]===a&&n===z||route[i]===z&&n===a),returns=loops.find(t=>t.loop.slice(1).some((n,i)=>t.loop[i]===a&&n===z||t.loop[i]===z&&n===a));
 const component=returns?(()=>{const seen=new Set<number>(),q=[returns.loop[1]!];seen.add(q[0]!);for(const c of q)for(const n of maze.passages[c]!)if(n!==returns.fork&&!seen.has(n)){seen.add(n);q.push(n);}return q;})():[];
 const entrances=returns?[...new Set(component.flatMap(c=>maze.passages[c]!.filter(n=>!component.includes(n))))]:[];
 const exitReachableWithout=(()=>{const seen=new Set([maze.entrance.cell]),q=[maze.entrance.cell];for(const c of q)for(const n of cut.passages[c]!)if(!seen.has(n)){seen.add(n);q.push(n);}return seen.has(maze.exit.cell);})();
 const g=bridgeGeometry(maze.free!,b);return {id:b.id,role:componentsWithout>1?'district-transition':'return-circuit',onShortestEntranceExitRoute:onMain,componentsWithoutBridge:componentsWithout,exitReachableWithoutBridge:exitReachableWithout,axis:{x:g.ux,z:g.uz},...(returns?{returnCircuit:{forkRoom:r.rooms[returns.fork]!.id,groundRooms:returns.loop.map(i=>r.rooms[i]!.id),length:pathLength(freeGraphPath(maze,returns.loop)),componentRooms:component.length,onlyNetworkAttachment:entrances.map(i=>r.rooms[i]!.id),containsEntranceOrExit:component.includes(maze.entrance.cell)||component.includes(maze.exit.cell)}}:{})};
});
const first=roles.find(r=>r.role==='district-transition')!,second=roles.find(r=>r.role==='return-circuit')!;assert(first&&second);assert(first.onShortestEntranceExitRoute&&!first.exitReachableWithoutBridge);assert(!second.onShortestEntranceExitRoute&&second.exitReachableWithoutBridge);assert(second.returnCircuit&&!second.returnCircuit.containsEntranceOrExit&&second.returnCircuit.onlyNetworkAttachment.length===1);
const axisDot=Math.abs(first.axis.x*second.axis.x+first.axis.z*second.axis.z);assert(axisDot<1e-6,'Bridge axes should be perpendicular');
const reportFile=file.replace(/\.json$/,'.validation.json'),report=await Bun.file(reportFile).json();assert.equal(report.sha256,createHash('sha256').update(raw).digest('hex'));report.bridgeRoles={axesAngleDegrees:90,roles};await Bun.write(reportFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.bridgeRoles,null,2));
