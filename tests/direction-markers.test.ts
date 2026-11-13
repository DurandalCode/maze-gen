import {expect,test} from 'bun:test';
import {generate} from '../src/generators/generate';
import {Recorder} from '../src/simulation/recorder';
import {directionMarkerShortcut,markerDirection,markerBearing} from '../src/simulation/direction-markers';
import {makeWalkData,validateWalk,restoreRecorder} from '../src/persistence/walk-json';
import {analyseDirectionMarkers,directionError} from '../src/analysis/direction-markers';
import {preferWalk} from '../src/persistence/walk-order';
const maze=generate({columns:1,rows:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'direction-markers'});
test('camera yaw records a subjective direction at exact active time without changing movement',()=>{
 const recorder=new Recorder({x:1,z:1});
 const marker=recorder.markDirection({x:1,z:1},Math.PI*2+Math.PI/2,.123456)!;
 expect(marker.time).toBe(.123456);expect(markerDirection(marker.yaw).x).toBeCloseTo(-1);expect(markerBearing(marker.yaw)).toBeCloseTo(270);
 expect(recorder.samples).toHaveLength(1);expect(recorder.distance).toBe(0);expect(recorder.elapsed).toBe(0);
 expect(Object.keys(marker).sort()).toEqual(['floor','kind','time','version','x','yaw','z']);
 const data=validateWalk(makeWalkData(maze,recorder,'stationary-marker',false,'in-progress'));
 expect(data.recording.elapsed).toBe(.123456);expect(restoreRecorder(data.recording).markers).toEqual(recorder.markers);
});
test('F captures once, including sprint; typing, modifiers, paused inspection and modals ignore it',()=>{
 const key={code:'KeyF',repeat:false,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,target:null};
 expect(directionMarkerShortcut(key,true)).toBe('mark');expect(directionMarkerShortcut({...key,shiftKey:true},true)).toBe('mark');
 expect(directionMarkerShortcut({...key,repeat:true},true)).toBe('repeat');
 for(const patch of [{code:'KeyG'},{ctrlKey:true},{metaKey:true},{altKey:true},{target:{closest:()=>({})} as unknown as EventTarget}])expect(directionMarkerShortcut({...key,...patch},true)).toBeNull();
 expect(directionMarkerShortcut(key,false)).toBeNull();expect(directionMarkerShortcut(key,true,true)).toBeNull();expect(directionMarkerShortcut(key,true,false,true)).toBeNull();
});
test('legacy JSON remains valid; marker JSON roundtrips and rejects malformed or out-of-time events',()=>{
 const recorder=new Recorder({x:1,z:1});recorder.record({x:1,z:2},2,true);
 const legacy=makeWalkData(maze,recorder,'legacy-direction',false,'stopped');expect(validateWalk(legacy).recording.markers).toBeUndefined();
 recorder.markDirection({x:1,z:2},0,2);const data=makeWalkData(maze,recorder,'new-direction',false,'stopped');
 expect(validateWalk(JSON.parse(JSON.stringify(data))).recording.markers).toEqual(recorder.markers);
 for(const patch of [{time:-1},{time:3},{yaw:NaN},{kind:'intent'},{version:2},{floor:1},{y:2}]){
  const bad=structuredClone(data);Object.assign(bad.recording.markers![0]!,patch);expect(()=>validateWalk(bad)).toThrow();
 }
 const old={...data,recording:{...data.recording,markers:undefined}};expect(preferWalk(data,old)).toBe(data);
});
test('post-map compares geometric finish direction and actual next movement, with wrap-safe angles',()=>{
 const recorder=new Recorder({x:1,z:1});recorder.markDirection({x:1,z:1},-Math.PI/2,0);
 recorder.record({x:1.2,z:1},.2,true);recorder.record({x:2,z:1},1,true);
 const row=analyseDirectionMarkers(maze,recorder.markers,recorder.samples)[0]!;
 expect(row.movementError).toBeCloseTo(0);expect(row.movementSeconds).toBe(1);expect(row.exitError).not.toBeNull();
 expect(analyseDirectionMarkers(maze,recorder.markers,recorder.samples.slice(0,2))[0]!.movementError).toBeNull();
 expect(directionError(markerDirection(.01),markerDirection(2*Math.PI-.01))).toBeCloseTo(.02*180/Math.PI);
});
