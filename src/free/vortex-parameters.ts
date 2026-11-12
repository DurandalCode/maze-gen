import {DEFAULT_DESIGN_LIMITS,type Parameters} from '../core/maze';
/** Only a deliberate mode selection applies the initial vortex preset.
 * Loading old files never changes their reproducible inputs. */
export function vortexParameters(p:Parameters):Parameters{return {...p,placementMode:'free',moduleSize:2,freeRoutePattern:'vortex',freeVortexCenter:false,freeVortexChaotic:false,freeVortexDeepRegions:false,freeVortexContinuous:false,freeVortexHybrid:false,freeVortexHybridDeep:false,freeVortexKnots:false,freeModuleTarget:96,columns:Math.max(p.columns,60),rows:Math.max(p.rows,60),freeSpanPolicy:'maximum',freeConnectionSpan:3,freeJunctionDegree:3,freeCavityMaze:false,freeInfillPassages:0,freeBridgeCount:0,freeRequiredBridgeCount:0,freeRequireUnderpass:false,freeZoneCount:0,freeIslandCount:0,extraConnections:40,routeTrapCount:0,loopTrapCount:0,design:{...DEFAULT_DESIGN_LIMITS,...p.design,maxForcedStraight:8,maxForcedRun:16}};}

export function centralVortexParameters(p:Parameters):Parameters{return {...vortexParameters(p),freeVortexCenter:true,columns:Math.max(p.columns,70),rows:Math.max(p.rows,70),extraConnections:16,routeTrapCount:2,loopTrapCount:2};}

export function knottedVortexParameters(p:Parameters):Parameters{return {...centralVortexParameters(p),freeVortexKnots:true,columns:60,rows:60,extraConnections:21,routeTrapCount:p.routeTrapCount??0,loopTrapCount:p.loopTrapCount??0};}

export function chaoticVortexParameters(p:Parameters):Parameters{return {...centralVortexParameters(p),freeVortexChaotic:true,extraConnections:17,routeTrapCount:2,loopTrapCount:2};}

export function districtVortexParameters(p:Parameters):Parameters{return {...chaoticVortexParameters(p),freeVortexDeepRegions:true,extraConnections:21};}

/** Explicitly selected continuous winding profile; older profiles retain run16. */
export function continuousVortexParameters(p:Parameters):Parameters{const q=chaoticVortexParameters(p);return {...q,freeVortexContinuous:true,extraConnections:2,design:{...DEFAULT_DESIGN_LIMITS,...q.design,maxForcedStraight:8,maxForcedRun:60,disabledLimits:q.design?.disabledLimits?.filter(k=>k!=='maxForcedStraight'&&k!=='maxForcedRun')}};}

/** Deliberate mode changes restore the ordinary bound; loading JSON never calls this. */
export function leaveContinuousVortex(p:Parameters):Parameters{return p.freeVortexContinuous||p.freeVortexHybrid?{...p,freeVortexContinuous:false,freeVortexHybrid:false,freeVortexHybridDeep:false,design:{...DEFAULT_DESIGN_LIMITS,...p.design,maxForcedRun:16}}:p;}

/** Explicit hybrid stage preserves the continuous profile's local8/60 preset. */
export function hybridVortexParameters(p:Parameters):Parameters{return {...continuousVortexParameters(p),freeVortexHybrid:true};}

/** Explicit experimental profile; older continuous/hybrid maps retain8/60. */
export function deepHybridVortexParameters(p:Parameters):Parameters{const q=hybridVortexParameters(p);return {...q,freeVortexHybridDeep:true,design:{...DEFAULT_DESIGN_LIMITS,...q.design,maxForcedStraight:8,maxForcedRun:64}};}
