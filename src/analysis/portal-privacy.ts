import {freePortalPrivacy} from '../free/portal-privacy';
import {storeyView} from '../core/two-storey';
import type {Maze,Portal} from '../core/maze';
import {legacyPrivacyScene} from '../compat/privacy-scene';
import {certifyAperturePrivacy} from './aperture-privacy';
export type {PortalPrivacy} from './aperture-privacy';
/** All formats use one oriented-geometry certificate; legacy coordinates stop at the adapter. */
export function portalPrivacy(maze:Maze,portal:Portal,maxPocketCells=3,findWitness=true){
 if(!Number.isInteger(maxPocketCells)||maxPocketCells<1||maxPocketCells>12)throw Error('Недопустимый размер кармана проёма.');
 if(maze.free)return freePortalPrivacy(maze,portal,maxPocketCells,findWitness);
 if(maze.storeys)return portalPrivacy(storeyView(maze,0),portal,maxPocketCells,findWitness);
 return certifyAperturePrivacy(legacyPrivacyScene(maze,portal),portal,maxPocketCells,findWitness);
}
export function mazePortalPrivacy(maze:Maze,findWitness=true){const entrance=portalPrivacy(maze,maze.entrance,3,findWitness),exit=portalPrivacy(maze,maze.exit,3,findWitness);return {certified:entrance.certified&&exit.certified,entrance,exit};}
