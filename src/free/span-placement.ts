export type SpanAttempt={ok:true}|{ok:false;kind:'geometry'|'length';reason:string};
export interface MaximumSpanPlacement<T>{candidate:T;span:number;reason?:string}
/** Try every orientation at the target before considering a smaller span.
 * Only an observed geometry failure permits fallback. A length failure never
 * permits compaction, including during refinement of a geometry fallback. */
export function maximumSpanPlacement<T>(candidates:readonly T[],desired:number,attempt:(candidate:T,span:number)=>SpanAttempt,expired:()=>boolean):MaximumSpanPlacement<T>|undefined {
 const constrained:{candidate:T;reason:string}[]=[];
 for(const candidate of candidates){
  if(expired())return;
  const result=attempt(candidate,desired);
  if(result.ok)return {candidate,span:desired};
  if(result.kind==='geometry')constrained.push({candidate,reason:result.reason});
 }
 const active=new Set(constrained);
 for(let reduction=.25;reduction<=Math.min(2,desired-1)+1e-8;reduction+=.25){
  const span=desired-reduction;
  for(const item of active){
   if(expired())return;
   const result=attempt(item.candidate,span);
   if(!result.ok){if(result.kind==='length')active.delete(item);continue;}
   let low=span,high=span+.25,rejectedForLength=false;
   // Recover the largest locally feasible span to about 2 cm; keep the search
   // bounded and do not assume global monotonicity around other modules.
   for(let i=0;i<4&&!expired();i++){
    const mid=(low+high)/2,test=attempt(item.candidate,mid);
    if(test.ok)low=mid;
    else if(test.kind==='length'){rejectedForLength=true;break;}
    else high=mid;
   }
   if(rejectedForLength){active.delete(item);continue;}
   if(!expired()&&attempt(item.candidate,low).ok)return {candidate:item.candidate,span:low,reason:item.reason};
  }
 }
}
