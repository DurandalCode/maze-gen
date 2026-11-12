import {DEFAULT_DESIGN_LIMITS,type Parameters} from '../core/maze';
/** Called only by an explicit new-mode action; loading old recipes never
 * changes their spacing policy or stricter saved bounds. */
export function maximumSpacingParameters(p:Parameters,enabled=true):Parameters{
 if(!enabled)return {...p,freeSpanPolicy:undefined,freeConnectionSpan:undefined};
 return {...p,freeSpanPolicy:'maximum',freeConnectionSpan:p.freeConnectionSpan??3,freeAngleSpread:p.freeAngleSpread??80,design:{...DEFAULT_DESIGN_LIMITS,...p.design,maxForcedStraight:8,maxForcedRun:16,disabledLimits:(p.design?.disabledLimits??['maxVisibleStraight']).filter(k=>k!=='maxForcedStraight'&&k!=='maxForcedRun')}};
}
