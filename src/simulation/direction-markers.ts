import type {Point} from '../core/maze';
/** The camera's subjective horizontal bearing, never the actual exit location. */
export interface DirectionMarker extends Point {version:1;kind:'perceived-exit';time:number;yaw:number}
export const DIRECTION_MARKER_LIMIT=2000;
export const normalizeYaw=(yaw:number)=>Math.atan2(Math.sin(yaw),Math.cos(yaw));
export const markerDirection=(yaw:number)=>({x:-Math.sin(yaw),z:-Math.cos(yaw)});
export function markerBearing(yaw:number){const d=markerDirection(yaw);return (Math.atan2(d.x,-d.z)*180/Math.PI+360)%360;}
export function directionMarkerShortcut(event:Pick<KeyboardEvent,'code'|'repeat'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'|'target'>,active:boolean,inspection=false,modal=false):'mark'|'repeat'|null{
 if(!active||inspection||modal||event.code!=='KeyF'||event.ctrlKey||event.metaKey||event.altKey)return null;
 const target=event.target as {closest?:(selector:string)=>unknown}|null;
 if(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[aria-modal="true"]'))return null;
 return event.repeat?'repeat':'mark';
}
