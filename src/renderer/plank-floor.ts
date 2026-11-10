import * as THREE from 'three';
import {random} from '../core/random';
import {woodMaterial} from './wood';

// Eight 20 cm boards across a repeat, with staggered joints along their length.
const TILE_WIDTH=1.6,TILE_LENGTH=4;
/** Reuse the frame's pine grain, adding board variation and narrow opaque seams. */
export function plankFloorMaterial():THREE.MeshStandardMaterial {
  const base=woodMaterial(),source=base.map!.image as {data:Uint8Array;width:number;height:number};
  const width=256,height=1024,pixels=new Uint8Array(width*height*4),rng=random('maze-lab-plank-deck-v1');
  const boards=Array.from({length:8},()=>({shade:.88+rng()*.22,offset:Math.floor(rng()*source.height),joint:Math.floor(rng()*height),grain:Math.floor(rng()*source.width)}));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const board=boards[Math.floor(x/32)]!,across=x%32,joint=(y-board.joint+height)%height;
    const sx=(Math.floor(across/32*source.width)+board.grain)%source.width,sy=(Math.floor(y/height*source.height)+board.offset)%source.height,i=(y*width+x)*4,j=(sy*source.width+sx)*4;
    // Seams are a surface detail, never transparent gaps in the ceiling.
    const seam=across<1||joint<2,bevel=across===1||across===31||joint===2,shade=board.shade*(seam?.27:bevel?.76:1);
    pixels[i]=Math.round(source.data[j]!*shade);pixels[i+1]=Math.round(source.data[j+1]!*shade);pixels[i+2]=Math.round(source.data[j+2]!*shade);pixels[i+3]=255;
  }
  base.map!.dispose();base.dispose();
  const map=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat);map.name='pine-plank-deck';map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.anisotropy=4;map.needsUpdate=true;
  return new THREE.MeshStandardMaterial({name:'pine-plank-floor-and-ceiling',map,roughness:.94,metalness:0});
}
/** World-aligned UVs keep the plank width constant and joints continuous across cells. */
export function plankSlabGeometry(x:number,z:number,width:number,thickness:number,depth:number):THREE.BoxGeometry {
  const geometry=new THREE.BoxGeometry(width,thickness,depth),position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
  for(let i=0;i<position.count;i++){
    const px=position.getX(i)+x,pz=position.getZ(i)+z;
    if(Math.abs(normal.getY(i))>.5)uv.setXY(i,px/TILE_WIDTH,pz/TILE_LENGTH);
    else if(Math.abs(normal.getX(i))>.5)uv.setXY(i,pz/TILE_LENGTH,position.getY(i)/.2);
    else uv.setXY(i,px/TILE_WIDTH,position.getY(i)/.2);
  }
  return geometry;
}
