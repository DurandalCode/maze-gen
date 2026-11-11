import type {Maze} from '../core/maze';
import {random} from '../core/random';
import {mazeDraft} from './json';
import {freeMaze,validateFree} from './layout';
import {analyzeFree,checkFreeQuality} from './quality';

export const FREE_PROFILES=['explorer','compass','outline'] as const;
export interface FreeProfileQuality {
  profile:typeof FREE_PROFILES[number]; completion:number; coldRatio:number;
  largestColdArea:number; unseenRatio:number;
}
export interface FreeOptimizationResult {
  maze:Maze; improved:boolean; attempted:number; accepted:number;
  before:FreeProfileQuality[]; after:FreeProfileQuality[];
}
export function freeQualityVector(maze:Maze,samples=256):FreeProfileQuality[]{
  return FREE_PROFILES.map(profile=>{
    const result=analyzeFree(maze,samples,profile);
    return {profile,completion:result.finishedRatio,coldRatio:result.coldAreaRatio,
      largestColdArea:result.largestColdArea,
      unseenRatio:result.unseenAreaRatio};
  });
}
/** No profile or metric may pay for deterioration in another. Route kilometres
 * are deliberately absent: this is a coverage improvement, not a human rating. */
export function dominatesFree(a:FreeProfileQuality[],b:FreeProfileQuality[]):boolean {
  let better=false;
  for(let i=0;i<a.length;i++){
    const x=a[i]!,y=b[i]!;
    if(x.completion<1||x.completion<y.completion)return false;
    for(const key of ['coldRatio','largestColdArea','unseenRatio'] as const){
      if(x[key]>y[key]+1e-9)return false;
      if(x[key]<y[key]-1e-9)better=true;
    }
  }
  return better;
}
/** Change one local module at a time; anchored openings follow it. The fixed
 * module/connection inventory and site remain unchanged, including manual walls. */
export function optimizeFree(base:Maze,attempts=96,samples=256,progress?:(done:number,total:number)=>void):FreeOptimizationResult {
  if(!base.free||!Number.isInteger(attempts)||attempts<1||attempts>128||!Number.isInteger(samples)||samples<1||samples>4096)throw Error('Некорректные параметры улучшения свободной планировки.');
  const baseline=mazeDraft(base);
  if(validateFree(baseline).length)throw Error('Сначала исправьте ошибки конструкции.');
  const rng=random(base.parameters.seed+':free-improve-v2'),before=freeQualityVector(base,samples);
  let best=base,after=before,accepted=0,attempted=0;
  const deadline=performance.now()+20000;
  for(let i=0;i<attempts&&performance.now()<deadline;i++){
    attempted++;progress?.(attempted,attempts);
    const draft=mazeDraft(best),module=draft.layout.modules[Math.floor(rng()*draft.layout.modules.length)]!;
    const scale=i%3===0?.8:i%3===1?.2:.05;
    module.x+=(rng()-.5)*scale;module.z+=(rng()-.5)*scale;module.angle+=(rng()-.5)*scale*15;
    if(validateFree(draft).length)continue;
    const candidate=freeMaze(draft,false);
    if(checkFreeQuality(candidate).length)continue;
    const vector=freeQualityVector(candidate,samples);
    if(dominatesFree(vector,after)){best=candidate;after=vector;accepted++;}
  }
  return {maze:best,improved:best!==base,attempted,accepted,before,after};
}
