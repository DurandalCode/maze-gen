import type {WalkAssessment} from '../analysis/walk-assessment';
import {assessWalk} from '../analysis/walk-assessment';
import {contentId,browserTopologyId} from './identity';
import {recordJson} from './record-codec';
import {validateWalk,type WalkData} from './walk-json';
/** Internal persistence boundary. Both representations derive from this one
 * complete validation; wire data is stored, runtime data is returned to callers. */
export interface PreparedOfflineWalk {
 walk:WalkData;wire:WalkData;mazeId:string;topologyId:string;assessment:WalkAssessment;
}
export async function prepareOfflineWalk(raw:unknown):Promise<PreparedOfflineWalk>{
 const walk=validateWalk(raw),assessment=assessWalk(walk.maze,walk.recording.samples,walk.recording.distance,walk.finished);
 const [mazeId,topologyId]=await Promise.all([contentId(walk.maze),browserTopologyId(walk.maze)]);
 return {walk,wire:JSON.parse(recordJson(walk)) as WalkData,mazeId,topologyId,assessment};
}
