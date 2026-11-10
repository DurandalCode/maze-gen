import {expect,test} from 'bun:test';
import {traceCommitment} from '../src/analysis/loop-credibility';
import type {DecisionFeatures} from '../src/analysis/decision-model';
const f=(direction:number,straight=0,exhausted=false):DecisionFeatures=>({direction,straight,exhausted,perspective:0,boundary:0,exitVisible:0,deadEnd:0});
const links=[[1,4,8,9],[0,2],[1,3,5],[2,4],[3,0],[2,6],[5],[],[0],[0]];
test('an attractive entry cannot borrow the length of a circuit when direction chooses a different continuation at the next T',()=>{
 const observed:number[]=[];
 const trace=traceCommitment(links,[8,0],1,(at,n)=>{observed.push(at);return f(at===2?(n===5?1:-1):0);},0);
 expect(trace.path).toEqual([0,1,2,5,6]);expect(trace.stop).toBe('dead-end');expect(trace.returnedToFork).toBe(false);expect(trace.decisions).toBe(1);
 expect(observed).not.toContain(3);expect(observed).not.toContain(4);
});
test('a locally compelling circuit reaches its remembered fork without knowing circuit membership',()=>{
 const trace=traceCommitment(links,[8,0],1,(at,n)=>f(at===2?(n===3?1:-1):0),0);
 expect(trace.path).toEqual([0,1,2,3,4]);expect(trace.stop).toBe('familiar');expect(trace.returnedToFork).toBe(true);
});
test('visible dead ends are rejected and the incoming course can change a close decision',()=>{
 const trace=traceCommitment(links,[8,0],1,(_at,n)=>f(0,n===3?1:-1),.25);
 expect(trace.returnedToFork).toBe(true);
 const visible=traceCommitment(links,[8,0],1,(at,n)=>f(n===5?1:0,0,at===2&&n===5),0);
 expect(visible.returnedToFork).toBe(true);expect(visible.decisions).toBe(0);
});
