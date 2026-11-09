import type {Maze} from '../core/maze';
import {routingSize,neighbors} from '../core/maze';
import {domainOf} from '../core/domain';
import {guardedMaze} from './guarded';
import {random,shuffle} from '../core/random';
import {generateBase} from './generate';

/** A constructive seed for the 9×9, three-module-thick P experiment.
 * The entrance route, near-exit blind branch and upward detour form one fixed tree;
 * randomized completion can attach branches but cannot create a shortcut through it.
 * Other shapes continue to use the generic guarded search.
 */
export function pRouteTrapMaze(base:Maze,seed:string):Maze|null {
  const size=routingSize(base),domain=domainOf(base);
  const {columns,rows}=size,lastRow=(rows-1)*columns;
  if(columns<17||rows<17||base.entrance.cell!==lastRow||base.exit.cell!==lastRow+columns-1||base.entrance.side!=='south'||base.exit.side!=='south')return null;
  let leg=0;while(domain.active[lastRow+leg])leg++;
  if(leg<5||leg*2>=columns)return null;
  for(let z=0;z<rows;z++)for(let x=0;x<columns;x++)if(Boolean(domain.active[z*columns+x])!==(z<leg||x<leg||x>=columns-leg))return null;
  const prepared=guardedMaze(base,seed,true),guard=prepared.constraints;
  const passages=base.passages.map(()=>[] as number[]),parent=passages.map((_,i)=>i),rng=random(seed+'|P-trap');
  const root=(n:number):number=>{while(parent[n]!==n){parent[n]=parent[parent[n]!]!;n=parent[n]!;}return n;};
  const add=(a:number,b:number,required=false)=>{const ra=root(a),rb=root(b);if(ra===rb){if(required&&!passages[a]!.includes(b))throw new Error('Cyclic trap template');return;}parent[ra]=rb;passages[a]!.push(b);passages[b]!.push(a);};
  const chain=(points:number[][])=>{
    const mapped=points.map(([x,z])=>[x!>=12?columns-17+x!:x!,z!>=8?rows-17+z!:z!]);
    for(let i=1;i<mapped.length;i++){
      const [x,z]=mapped[i-1]!,[tx,tz]=mapped[i]!;if(x!==tx&&z!==tz)throw new Error('Non-axial template');
      let a=z!*columns+x!;const step=x===tx?Math.sign(tz!-z!)*columns:Math.sign(tx!-x!);
      while(a!==tz!*columns+tx!){const b=a+step;if(!neighbors(base,a).includes(b))throw new Error('Trap outside shape');add(a,b,true);a=b;}
    }
  };
  const forkRow=10+Math.floor(rng()*3),topRow=forkRow-(4+Math.floor(rng()*2));
  const doubleTrap=(base.parameters.routeTrapCount??0)>=2;
  if(doubleTrap){
    chain([[0,16],[0,15],[1,15],[1,16],[2,16],[2,14],[1,14],[1,8],[2,8],[2,13],[3,13],[3,1],[12,1],[12,forkRow],[13,forkRow]]);
    chain([[2,8],[2,5],[1,5],[1,4]]);
  }else chain([[0,16],[0,15],[1,15],[1,16],[2,16],[2,12],[0,12],[0,8],[2,8],[4,8],[4,6],[2,6],[2,0],[4,0],[4,1],[12,1],[12,forkRow],[13,forkRow]]);
  chain([[13,forkRow],[13,topRow],[16,topRow],[16,14],[14,14],[14,16],[15,16],[15,15],[16,15],[16,16]]);
  // The apparently direct descent ends six metres from the exit cell, behind a bend.
  chain([[13,forkRow],[13,15],[12,15],[12,16],[13,16]]);
  for(const [a,b] of guard.mandatory)add(a,b,true);
  const generated=generateBase({...base.parameters,seed});
  const pairs=[...guard.allowed];shuffle(pairs,rng);
  for(const [a,b] of pairs)if(generated.passages[a]!.includes(b))add(a,b);
  for(const [a,b] of pairs)add(a,b);
  for(const p of passages)p.sort((a,b)=>a-b);
  return {...base,parameters:{...base.parameters,seed},passages};
}
