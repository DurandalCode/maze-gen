import type {DesignLimits,Parameters} from './maze';
export type LimitKey = 'maxForcedStraight'|'maxForcedRun'|'maxVisibleStraight'|'maxColdRatio'|'maxColdRegion'|'maxUnavoidableRouteRatio'|'maxColdSideRatio';
export const LIMIT_KEYS:LimitKey[]=['maxForcedStraight','maxForcedRun','maxVisibleStraight','maxColdRatio','maxColdRegion','maxUnavoidableRouteRatio','maxColdSideRatio'];
/** Disabled bounds are explicit, persisted switches; numeric values survive toggling. */
export function effectiveLimits(p:Parameters){
 const d=p.design,living=p.generationType==='living';
 const value=(key:LimitKey,fallback:number)=>d?.disabledLimits?.includes(key)?Infinity:d?.[key]??fallback;
 return {maxForcedStraight:value('maxForcedStraight',living?Infinity:12),maxForcedRun:value('maxForcedRun',living?Infinity:20),maxVisibleStraight:value('maxVisibleStraight',Infinity),maxColdRatio:value('maxColdRatio',Infinity),maxColdRegion:value('maxColdRegion',Infinity),maxUnavoidableRouteRatio:value('maxUnavoidableRouteRatio',Infinity),maxColdSideRatio:value('maxColdSideRatio',Infinity)};
}
export function defaultDesign(living:boolean,defaults:Readonly<DesignLimits>):DesignLimits{
 return {...defaults,...(living?{disabledLimits:['maxForcedStraight','maxForcedRun','maxVisibleStraight'] as LimitKey[]}: {})};
}
