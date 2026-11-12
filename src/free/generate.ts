import {generateDenseGameplay} from './dense-gameplay';
import {generateVortex} from './vortex';
import {DEFAULT_DESIGN_LIMITS} from '../core/maze';
import {generateCavityMaze} from './cavity-maze';
import type { Maze, Parameters } from '../core/maze';
import { generateOrganic } from './organic';
import {infillFree} from './infill';
import {checkFreeQuality} from './quality';
import {freeGroundLengths,freeLengthLimits} from './path-limits';
/** All free placement is grown from world-space doorways, without a lattice. */
export function generateFree(parameters: Parameters, previous?: Maze, onProgress?: (message: string) => void): Maze {
  if(parameters.freeRoutePattern==='vortex')return generateVortex(parameters,previous,onProgress);
  if(parameters.freePassagePattern==='organic-sectors-v1'&&(parameters.loopTrapCount??0)>0)throw Error('Органические межсекторные связи пока поддерживают маршрутные Л без обязательного возвратного К.');
  const baseParameters=parameters.freeCavityMaze&&parameters.freeAngleSpread===0&&parameters.freeConnectionSpan===undefined&&parameters.freeSpanPolicy!=='maximum'?{...parameters,design:{...DEFAULT_DESIGN_LIMITS,...parameters.design,maxForcedStraight:Math.min(parameters.design?.maxForcedStraight??8,4),maxForcedRun:Math.min(parameters.design?.maxForcedRun??16,8)}}:parameters;
  const denseTraps=parameters.freeCavityMaze&&parameters.freeCourtyardPolicy==='dense-v3'&&(parameters.routeTrapCount??0)>0;
  // Requested return loops consume their cycle budget in the dense feature
  // pass. Reserving it here keeps the organic composition reproducible.
  let base=generateOrganic(denseTraps?{...baseParameters,extraConnections:Math.max(0,baseParameters.extraConnections-(parameters.loopTrapCount??0)),routeTrapCount:0,loopTrapCount:0}:baseParameters,previous,onProgress);
  if(parameters.freeInfillPassages){
    const physicalLimits=freeLengthLimits(parameters);
    const limits=parameters.freeRoutePattern==='switchbacks'?{maxStraight:8,maxRun:16,allowEmpty:true,maxCandidates:24}:parameters.generationType!=='living'?{maxStraight:physicalLimits.straight,maxRun:physicalLimits.run,maxCandidates:24}:undefined;
    const result=infillFree(base,parameters.freeInfillPassages,Math.min(parameters.corridorWidth,1.4),onProgress,limits);base=result.maze;
    onProgress?.(`Поперечные связи: ${result.addedPassages}/${parameters.freeInfillPassages}.`);
  }
  if(parameters.freeCavityMaze){const result=generateCavityMaze(base,onProgress);base=result.maze;onProgress?.(base.free!.cavityReport?.construction?`Модульное заполнение: добавлено ${base.free!.cavityReport.construction.addedModules} настоящих модулей, открыто ${base.free!.cavityReport.construction.openedCourtyards} дворов.`:`В пустотах: ${result.chambers} камер, ${result.externalDoors} выборочных входов; ${result.closedWalls} смежностей остались стенами.`);}
  if(denseTraps)base=generateDenseGameplay(base,parameters,onProgress);
  if(parameters.freeCavityMaze){const limits=freeLengthLimits(parameters),lengths=freeGroundLengths(base);if(lengths.straight>limits.straight+1e-7||lengths.run>limits.run+1e-7)throw Error(`Длины всего лабиринта с камерами: ${lengths.straight.toFixed(2)}/${lengths.run.toFixed(2)} м превышают заданные пределы.`);}
  // Parameters remain the reproducible inputs. The cavity option separately
  // carves its selected internal tree/loop graph after the short organic base.
  base.parameters={...parameters};
  if(parameters.freeInfillPassages||parameters.freeCavityMaze){const issues=checkFreeQuality(base,{quick:true});if(issues.length)throw Error('Дополнительные проходы нарушают требования: '+issues.join(' '));}
  return base;
}
