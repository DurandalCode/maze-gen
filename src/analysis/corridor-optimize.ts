import {sideDistricts} from './side-districts';
import {domainOf} from '../core/domain';
import type {Maze} from '../core/maze';
import {generateCorridor} from '../generators/corridor';
import {analyzeColdspots,type AnalysisOptions} from './coldspots';
import {analyzePotential} from './potential-difficulty';
import type {OptimizationObjective,OptimizationResult} from './optimize';
/** Rebuild placements and doors together; arbitrary raster wall swaps could
 * introduce a partition or a post inside a long module. */
export function optimizeCorridor(base:Maze,options:AnalysisOptions,attempts:number,progress:((done:number,total:number)=>void)|undefined,objective:OptimizationObjective):OptimizationResult{
 const deadline=Date.now()+20000;const budget=Math.min(attempts,12),rank={...options,samples:Math.min(options.samples,64)},beforePotential=analyzePotential(base,rank,undefined,false),before=evaluate(base);
 function evaluate(m:Maze){return (['explorer','compass','outline'] as const).reduce((sum,profile)=>{const h=analyzeColdspots(m,{...rank,profile});const district=sideDistricts(m,h.probability,h.options.threshold),area=domainOf(m).area;return sum+h.coldAreaRatio+.5*h.largestColdArea/area+1.5*district.largestProblemArea/area+.5*district.problemArea/area;},0)/3;}
 let maze=base,best=before,potential=beforePotential,accepted=0;
 let attempted=0;for(let i=0;i<budget&&Date.now()<deadline;i++){
  attempted++;
  progress?.(i,budget);
  try{const candidate=generateCorridor({...base.parameters,seed:`${base.parameters.seed}:improve:${i}`},base,undefined,deadline),p=analyzePotential(candidate,rank,undefined,false),score=evaluate(candidate);if(p.eligible&&(objective==='exploration'?(p.score??-Infinity)>(potential.score??-Infinity):score<best-1e-7)){maze=candidate;best=score;potential=p;accepted++;}}catch{/* Keep the baseline when constraints cannot be met in this budget. */}
 }
 progress?.(budget,budget);return {objective,maze,changed:maze!==base,attempted,accepted,before,after:best,beforePotential,afterPotential:potential};
}
