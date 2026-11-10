import {corridorNavigation,openingMidpoint,rayDistance,roomAnchor} from '../core/corridor-navigation';
import {domainOf} from '../core/domain';
import {portalPoint,type Maze,type Point} from '../core/maze';
import {pathLength,routePoints} from '../core/pathfinding';
import {random} from '../core/random';
import {prepareNavigation,prepareOutline,cellAtPoint} from './navigation';
import {measureLandmarks} from './visibility';
import type {AnalysisOptions,ColdspotAnalysis,ColdRegion} from './coldspots';
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
/** A continuous position moves doorway-to-doorway inside a visible rectangular
 * space. The policy has no solution path and discovers openings on arrival. */
export function corridorSearch(input:Maze,options:AnalysisOptions):ColdspotAnalysis{
 const maze=input.navigation?input:corridorNavigation(input),g=maze.navigation!,d=domainOf(maze),ctx=prepareNavigation(maze),landmarks=measureLandmarks(maze,ctx),root=maze.entrance.cell,finish=maze.exit.cell,start=portalPoint(maze,maze.entrance),goal=portalPoint(maze,maze.exit),count=maze.passages.length;
 const probability=new Float64Array(count),visits=new Float64Array(count),rng=random('corridor-search-v10'),doors=new Map<string,Point>();
 const door=(a:number,b:number)=>{const key=a<b?`${a}:${b}`:`${b}:${a}`;let p=doors.get(key);if(!p){p=openingMidpoint(maze,a,b);doors.set(key,p);}return p;};
 if(options.profile==='outline')prepareOutline(maze,ctx);
 const proofs=new Map<string,boolean>(),portalRooms=new Set((maze.portals??[maze.entrance,maze.exit]).map(p=>p.cell));
 const visibleBlind=(from:number,to:number,point:Point)=>{
  if(maze.passages[to]!.length!==1||portalRooms.has(to))return false;
  const key=`${from}:${to}:${point.x}:${point.z}`,old=proofs.get(key);if(old!==undefined)return old;
  const r=d.rectangles[to]!,corners=[{x:r.x1+.1,z:r.z1+.1},{x:r.x2-.1,z:r.z1+.1},{x:r.x2-.1,z:r.z2-.1},{x:r.x1+.1,z:r.z2-.1}],visible=corners.every(q=>{const length=distance(point,q);return length<=24&&rayDistance(g.source,point,Math.atan2(q.z-point.z,q.x-point.x),length)>=length-1e-7;});proofs.set(key,visible);return visible;
 };
 let expectedLength=0;
 for(let run=0;run<options.samples;run++){
  let at=root,point=roomAnchor(maze,root,start),length=distance(start,roomAnchor(maze,root,start)),last:Point|undefined;const seen=new Set<number>(),blind=new Set<string>();const known:number[][]=Array.from({length:count},()=>[]);let sign=options.boundaryStrategy==='avoid'?-1:1,switches=0;
  for(let step=0;step<count*count+count;step++){
   seen.add(at);visits[at]!++;
   for(const n of maze.passages[at]!){if(!known[at]!.includes(n))known[at]!.push(n);if(!known[n]!.includes(at))known[n]!.push(at);}
   if(at===finish){const anchor=roomAnchor(maze,finish,goal);length+=distance(point,anchor)+distance(anchor,goal);break;}
   for(const n of known[at]!)if(visibleBlind(at,n,point))blind.add(`${at}:${n}`);
   const choices=known[at]!.filter(n=>!seen.has(n)&&!blind.has(`${at}:${n}`));let path:number[];
   const memory=options.routeMemory??1;
   if(memory<1&&rng()<.2*(1-memory)){const revisits=known[at]!.filter(n=>seen.has(n)&&!blind.has(`${at}:${n}`));if(revisits.length)choices.push(revisits[Math.floor(rng()*revisits.length)]!);}
   if(choices.length&&options.decisionMode!=='frontier'){
    const room=d.rectangles[at]!,gx=goal.x-point.x,gz=goal.z-point.z,goalDistance=distance(point,goal);let visibleExitDoor:number|null=null;
    if(goalDistance<=24&&rayDistance(g.source,point,Math.atan2(gz,gx),goalDistance)>=goalDistance-1e-7){const tx=gx>0?(room.x2-point.x)/gx:gx<0?(room.x1-point.x)/gx:Infinity,tz=gz>0?(room.z2-point.z)/gz:gz<0?(room.z1-point.z)/gz:Infinity,t=Math.min(tx,tz)+1e-5;visibleExitDoor=cellAtPoint(maze,{x:point.x+gx*t,z:point.z+gz*t});}
    const scores=choices.map(n=>{
     const p=door(at,n),dx=p.x-point.x,dz=p.z-point.z,len=Math.hypot(dx,dz)||1,target=options.profile==='outline'?ctx.outlineTargets?.[at]??goal:goal,heading=(dx*(target.x-point.x)+dz*(target.z-point.z))/(len*distance(point,target)||1),anchor=options.diagonalVision===false?roomAnchor(maze,at,p):point,angle=options.diagonalVision===false?Math.abs(p.x-room.x1)<1e-7?Math.PI:Math.abs(p.x-room.x2)<1e-7?0:Math.abs(p.z-room.z1)<1e-7?-Math.PI/2:Math.PI/2:Math.atan2(dz,dx),sight=rayDistance(g.source,anchor,angle,24),boundary=Math.min(...g.domain.boundary.map(({wall:w})=>distance(p,{x:Math.max(Math.min(w.x1,w.x2),Math.min(Math.max(w.x1,w.x2),p.x)),z:Math.max(Math.min(w.z1,w.z2),Math.min(Math.max(w.z1,w.z2),p.z))}))),straight=last?((point.x-last.x)*dx+(point.z-last.z)*dz)/(distance(point,last)*len||1):0,cue=Math.max(options.internalOrientation??1,landmarks.sun[at]!,landmarks.forest[at]!,landmarks.boundary[at]!);
     return options.profile==='explorer'?12*Number(n===visibleExitDoor):12*Number(n===visibleExitDoor)+(options.beta??3)*cue*heading+(options.corridorPreference??1)*Math.log1p(sight)+.15*straight+(options.profile==='outline'?(options.boundaryPreference??1.5)*sign*Math.exp(-boundary/3):0);
    });
    const maximum=Math.max(...scores),weights=scores.map(s=>Math.exp(s-maximum));let pick=rng()*weights.reduce((a,b)=>a+b,0),chosen=choices.at(-1)!;for(let i=0;i<choices.length;i++){pick-=weights[i]!;if(pick<=0){chosen=choices[i]!;break;}}path=[at,chosen];
   }else{
    // Routes expand entered spaces only. Unentered spaces can be destinations,
    // never hidden intermediate shortcuts through an unexplored room.
    const queue=[at],parent=new Int32Array(count).fill(-1);parent[at]=at;const candidates:number[]=[];
    for(let i=0;i<queue.length;i++){const c=queue[i]!;for(const n of known[c]!){if(parent[n]!==-1||blind.has(`${c}:${n}`))continue;parent[n]=c;if(seen.has(n))queue.push(n);else candidates.push(n);}}
    if(!candidates.length)throw Error('Коридорный поиск не достиг выхода.');
    const target=options.profile==='explorer'?candidates[Math.floor(rng()*candidates.length)]!:candidates.sort((a,b)=>{const pa=door(parent[a]!,a),pb=door(parent[b]!,b);return (options.profile==='outline'?ctx.outlineDistances![a]!:distance(pa,goal))-(options.profile==='outline'?ctx.outlineDistances![b]!:distance(pb,goal))||a-b;})[0]!;path=[target];while(path.at(-1)!==at)path.push(parent[path.at(-1)!]!);path.reverse();
    if(options.boundaryStrategy==='adaptive'&&switches<2){sign=-sign;switches++;}
   }
   for(let i=1;i<path.length;i++){const p=door(path[i-1]!,path[i]!),out=roomAnchor(maze,path[i-1]!,p),enter=roomAnchor(maze,path[i]!,p);length+=distance(point,out)+distance(out,enter);last=point;point=enter;at=path[i]!;if(i<path.length-1){seen.add(at);visits[at]!++;}}
   if(step===count*count+count-1)throw Error('Превышен бюджет коридорного поиска.');
  }
  for(const c of seen)probability[c]!++;expectedLength+=length/options.samples;
 }
 for(const c of d.cells){probability[c]!/=options.samples;visits[c]!/=options.samples;}
 const target=input.navigation?maze:g.source,targetDomain=domainOf(target),p=input.navigation?probability:Float64Array.from({length:target.passages.length},(_,c)=>g.originalToRegion[c]!<0?0:probability[g.originalToRegion[c]!]!),v=input.navigation?visits:Float64Array.from({length:target.passages.length},(_,c)=>g.originalToRegion[c]!<0?0:visits[g.originalToRegion[c]!]!);
 const checked=new Set<number>(),regions:ColdRegion[]=[];let coldArea=0,largestColdArea=0;
 for(const c of targetDomain.cells){if(checked.has(c)||p[c]!>=options.threshold)continue;const cells=[c];checked.add(c);let area=0;for(let i=0;i<cells.length;i++){const n=cells[i]!,r=targetDomain.rectangles[n]!;area+=(r.x2-r.x1)*(r.z2-r.z1);for(const q of target.passages[n]!)if(!checked.has(q)&&p[q]!<options.threshold){checked.add(q);cells.push(q);}}regions.push({cells,area});coldArea+=area;largestColdArea=Math.max(largestColdArea,area);}
 const optimalLength=pathLength(routePoints(g.source));
 return {options,landmarks:input.navigation?landmarks:measureLandmarks(g.source,prepareNavigation(g.source)),probability:p,visits:v,regions,coldArea,coldAreaRatio:coldArea/targetDomain.area,largestColdArea,expectedLength,optimalLength,searchRatio:optimalLength?expectedLength/optimalLength:1,method:'sampled',samples:options.samples};
}
