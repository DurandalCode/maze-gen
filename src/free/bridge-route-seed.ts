import type {Parameters,Point} from '../core/maze';
import type {FreeLayout,FreeModule} from './model';
import {seedFreeBridges} from './bridge-generate';
import {modulePolygon} from './layout';
export function seedBridgeRoute(l:FreeLayout,p:Parameters,center:Point,angle:number,height:number,width:number){
 const count=p.freeBridgeCount!,required=p.freeRequiredBridgeCount!,rad=angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);
 const at=(x:number,z:number)=>({x:center.x+x*c-z*s,z:center.z+x*s+z*c});
 const inverse=(p:Point)=>({x:(p.x-center.x)*c+(p.z-center.z)*s,z:-(p.x-center.x)*s+(p.z-center.z)*c});
 seedFreeBridges(l,count,center,angle,height,width);
 for(let i=0;i<required;i++){
  const side=i%2?'right':'left',id=i===count-1?`bridge-${side}-ground`:`bridge-${side}-link-${i+1}`;
  l.connections=l.connections.filter(link=>link.id!==id);
 }
 const groups=new Map<string,string>([...l.modules,...l.spaces].map(m=>[m.id,'network']));groups.set('bridge-left-0','entrance');
 const first=-(count-1)*2,last=-first,reservations:Point[][]=[];
 const underSideOffset=count>1&&count%2?2:0;
 // Reserve real jambs for the required lower junction. A uniform rail support
 // must not be planted in the middle of its future doorway.
 if(count>1){l.supports=l.supports!.filter(p=>{const q=inverse(p);return Math.abs(q.x-1)>1e-7||Math.abs(q.z-underSideOffset)>=width/2-1e-7;});l.supports.push(at(1,underSideOffset-width/2),at(1,underSideOffset+width/2));}
 const wall=(id:string,x1:number,z1:number,x2:number,z2:number)=>{const a=at(x1,z1),b=at(x2,z2);l.walls.push({id,x1:a.x,z1:a.z,x2:b.x,z2:b.z});};
 for(let i=0;i<count-1;i++){const z=first+1.5+i*4;if(i%2)wall(`lower-screen-${i}`,1,z,-.3,z);else wall(`lower-screen-${i}`,-1,z,.3,z);}
 const span=Math.max(...l.modules.map(m=>Math.hypot(m.x-center.x,m.z-center.z)));
 // Alternating physical screens, retaining enough clearance for a real person.
 for(let x=-4,i=0;x<span-2;x+=4,i++)if(i%2)wall(`ground-screen-${i}`,x,last+5,x,last+3.7);else wall(`ground-screen-${i}`,x,last+3,x,last+4.3);
 let exitAnchor={room:'bridge-underpass',edge:0,offset:0};
 if(p.loopTrapCount){
  const z=first-3,ring:[string,number,number,FreeModule['type'],number][]=[['fork',0,0,'2x2',0],['w',0,-6,'2x6',90],['nw',0,-12,'2x2',0],['n',6,-12,'2x6',0],['ne',12,-12,'2x2',0],['e',12,-6,'2x6',90],['se',12,0,'2x2',0],['s',6,0,'2x6',0]];
  for(const [id,x,y,type,rotation]of ring){const m={id:`return-${id}`,type,...at(x,z+y),angle:angle+rotation};l.modules.push(m);groups.set(m.id,id==='fork'?'network':'loop');
   if(type==='2x6'){const a=(angle+rotation)*Math.PI/180,tx=(x:number,y:number)=>({x:m.x+x*Math.cos(a)-y*Math.sin(a),z:m.z+x*Math.sin(a)+y*Math.cos(a)}),v=tx(.5,-1),w=tx(.5,.3);l.walls.push({id:`return-screen-${id}`,x1:v.x,z1:v.z,x2:w.x,z2:w.z});}
  }
  const sides=[[0,1],[3,2],[1,3],[1,3],[2,3],[1,0],[3,1],[3,1]];
  for(let i=0;i<8;i++)l.connections.push({id:`return-link-${i}`,a:{room:`return-${ring[i]![0]}`,edge:sides[i]![0]!,offset:0},b:{room:`return-${ring[(i+1)%8]![0]}`,edge:sides[i]![1]!,offset:0},width});
  l.connections.push({id:'return-approach',a:{room:'bridge-underpass',edge:0,offset:0},b:{room:'return-fork',edge:2,offset:0},width});
  reservations.push([at(1,z-11),at(11,z-11),at(11,z-1),at(1,z-1)]);
  exitAnchor={room:'return-fork',edge:3,offset:0};
 }
 const half=Math.abs(inverse(l.modules[0]!).x);
 const fits=(group:string,poly:Point[])=>poly.map(inverse).every(v=>group==='entrance'?v.x<=-half+1&&v.z>=first-3:group==='exit'?(p.loopTrapCount?v.x< -1||v.z<first-16:v.z<first-1):group==='loop'?v.x>=-6&&v.x<=18&&v.z>=first-22&&v.z<=first-1:v.x>=-half-3&&v.z>=first-1);
 const target=(group:string)=>group==='entrance'?at(-half-14,last+8):group==='exit'?(l.modules.some(m=>groups.get(m.id)==='exit'&&inverse(m).z<first-18)?at(16,first-26):at(-8,first-26)):undefined;
 return {groups,reservations,exitAnchor,underSideOffset,fits,target,cycles:count-required+Number(!!p.loopTrapCount),inherit:(child:string,parent:string)=>groups.set(child,groups.get(parent)??'network'),ringSides:l.modules.filter(m=>['return-w','return-n','return-e','return-se'].includes(m.id)).map(m=>({id:m.id,polygon:modulePolygon(m)}))};
}
