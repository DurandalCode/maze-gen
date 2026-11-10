import type {Maze,Parameters,Point,Wall} from './maze';
export interface PlacedModule {id:string;type:'2x2'|'2x6';x:number;z:number;rotation:0|90}
export interface Rectangle {x1:number;z1:number;x2:number;z2:number}
/** Explicit physical placement; navigation subdivisions are rebuilt from this data. */
export interface CorridorSpace {kind:'corridor'|'hall';x:number;z:number;width:number;height:number}
export interface CorridorLayout {modules:PlacedModule[];spaces?:CorridorSpace[];networkVersion?:2|3|4}
export const mm=(n:number)=>Math.round(n*1000);
export const metres=(n:number)=>n/1000;
export function footprint(m:PlacedModule):Rectangle{return {x1:mm(m.x),z1:mm(m.z),x2:mm(m.x)+(m.type==='2x6'&&m.rotation===0?6000:2000),z2:mm(m.z)+(m.type==='2x6'&&m.rotation===90?6000:2000)};}
export function footprintContains(p:Parameters,x:number,z:number):boolean{
 if(x<0||z<0||x>mm(p.columns)||z>mm(p.rows))return false;
 if(!p.shape)return true;
 const inside=(r:{x:number;z:number;width:number;height:number})=>x>=mm(r.x)&&x<=mm(r.x+r.width)&&z>=mm(r.z)&&z<=mm(r.z+r.height);
 return p.shape.rectangles.some(r=>r.operation==='add'&&inside(r))&&!p.shape.rectangles.some(r=>r.operation==='subtract'&&x>mm(r.x)&&x<mm(r.x+r.width)&&z>mm(r.z)&&z<mm(r.z+r.height));
}
export function walkableContains(maze:Maze,x:number,z:number):boolean{
 return footprintContains(maze.parameters,x,z)&&(!maze.layout?.spaces||maze.layout.spaces.some(r=>x>=mm(r.x)&&x<=mm(r.x+r.width)&&z>=mm(r.z)&&z<=mm(r.z+r.height)));
}
export function validateSpaces(maze:Maze):void{
 const spaces=maze.layout!.spaces;if(spaces===undefined)return;
 if(!Array.isArray(spaces)||!spaces.length||spaces.length>10000)throw Error('Некорректная сеть пространств.');
 for(const r of spaces){if(!r||!['corridor','hall'].includes(r.kind)||![r.x,r.z,r.width,r.height].every(v=>Number.isFinite(v)&&Math.abs(v*10-Math.round(v*10))<1e-7)||r.width<=0||r.height<=0||r.x<0||r.z<0||mm(r.x+r.width)>mm(maze.parameters.columns)||mm(r.z+r.height)>mm(maze.parameters.rows))throw Error('Некорректное пространство.');
 for(let x=mm(r.x)+50;x<mm(r.x+r.width);x+=100)for(let z=mm(r.z)+50;z<mm(r.z+r.height);z+=100)if(!footprintContains(maze.parameters,x,z))throw Error('Пространство вне площадки.');}
 if(maze.layout!.networkVersion!==undefined&&![2,3,4].includes(maze.layout!.networkVersion))throw Error('Некорректная версия сети.');
 const halls=spaces.filter(r=>r.kind==='hall');
 if(maze.layout!.networkVersion!==undefined)for(const h of halls)for(const m of maze.layout!.modules){const r=footprint(m);if(Math.min(mm(h.x+h.width),r.x2)>Math.max(mm(h.x),r.x1)&&Math.min(mm(h.z+h.height),r.z2)>Math.max(mm(h.z),r.z1))throw Error('Зал должен находиться между модулями.');}
 if((maze.layout!.networkVersion??0)>=3){
  const corridorAt=(x:number,z:number)=>spaces.some(r=>r.kind==='corridor'&&x>r.x&&x<r.x+r.width&&z>r.z&&z<r.z+r.height);
  for(const h of halls){if(spaces.some(r=>r.kind==='corridor'&&Math.min(h.x+h.width,r.x+r.width)>Math.max(h.x,r.x)&&Math.min(h.z+h.height,r.z+r.height)>Math.max(h.z,r.z)))throw Error('Зал должен занимать пустоту между коридорами.');for(let x=h.x+.05;x<h.x+h.width;x+=.1)if(!corridorAt(x,h.z-.05)||!corridorAt(x,h.z+h.height+.05))throw Error('Зал должен занимать замкнутый двор коридорной сети.');for(let z=h.z+.05;z<h.z+h.height;z+=.1)if(!corridorAt(h.x-.05,z)||!corridorAt(h.x+h.width+.05,z))throw Error('Зал должен занимать замкнутый двор коридорной сети.');}
 }
for(let a=0;a<halls.length;a++)for(let b=a+1;b<halls.length;b++){const x=halls[a]!,y=halls[b]!;if(Math.min(x.x+x.width,y.x+y.width)>Math.max(x.x,y.x)&&Math.min(x.z+x.height,y.z+y.height)>Math.max(x.z,y.z))throw Error('Залы пересекаются.');}
}
const cutsCache=new WeakMap<object,Map<string,number[]>>();
export function axisCuts(maze:Maze,axis:'x'|'z'):number[]{
 let cached=cutsCache.get(maze.layout!);if(!cached){cached=new Map();cutsCache.set(maze.layout!,cached);}const known=cached.get(axis);if(known)return known;
 const horizontal=axis==='x',values=new Set([0,mm(horizontal?maze.parameters.columns:maze.parameters.rows)]);
 for(const m of maze.layout!.modules){const r=footprint(m);values.add(horizontal?r.x1:r.z1);values.add(horizontal?r.x2:r.z2);}
 for(const r of maze.layout!.spaces??[]){values.add(mm(horizontal?r.x:r.z));values.add(mm(horizontal?r.x+r.width:r.z+r.height));}
 for(const r of maze.parameters.shape?.rectangles??[]){values.add(mm(horizontal?r.x:r.z));values.add(mm(horizontal?r.x+r.width:r.z+r.height));}
 // Structural cross headers span only the corridor width. Split long gap runs at
 // supported positions on module sides, never inside a module's open interior.
 for(let v=1000;v<mm(horizontal?maze.parameters.columns:maze.parameters.rows);v+=1000)values.add(v);
 const sorted=[...values].sort((a,b)=>a-b),result=sorted.map(metres);cached.set(axis,result);return result;
}
export function moduleAt(maze:Maze,p:Point):string|null{const x=mm(p.x),z=mm(p.z);return maze.layout!.modules.find(m=>{const r=footprint(m);return x>r.x1&&x<r.x2&&z>r.z1&&z<r.z2;})?.id??null;}
export function validateCorridorParameters(p:Parameters):void{
 if(![p.columns,p.rows].every(v=>Number.isFinite(v)&&v>=2&&v<=100&&Math.abs(v*10-Math.round(v*10))<1e-7))throw Error('Размеры площадки: от 2 до 100 м с шагом 0,1 м.');
 if(!Number.isFinite(p.corridorWidth)||p.corridorWidth<1||p.corridorWidth>3||Math.abs(p.corridorWidth*10-Math.round(p.corridorWidth*10))>1e-7)throw Error('Максимальная ширина прохода: от 1 до 3 м с шагом 0,1 м.');
 if(p.moduleSize!==2)throw Error('Коридорный тип использует модули 2×2 и 2×6 м.');
 for(const r of p.shape?.rectangles??[])if(![r.x,r.z,r.width,r.height].every(v=>Number.isFinite(v)&&Math.abs(v*10-Math.round(v*10))<1e-7)||r.x<0||r.z<0||r.width<=0||r.height<=0||mm(r.x)+mm(r.width)>mm(p.columns)||mm(r.z)+mm(r.height)>mm(p.rows)||!['add','subtract'].includes(r.operation))throw Error('Прямоугольники формы должны находиться в площадке; шаг 0,1 м.');
 if(p.shape&&(p.shape.kind!=='grid-rectangles'||!Array.isArray(p.shape.rectangles)))throw Error('Некорректная форма площадки.');
 const summary=footprintSummary(p);if(!summary.area||!summary.connected)throw Error('Площадка должна быть непустой и связной по сторонам.');
}
export function validatePlacement(maze:Maze):void{
 const list=maze.layout?.modules;if(!Array.isArray(list)||!list.length||list.length>2500)throw Error('Некорректное размещение модулей.');
 validateSpaces(maze);const ids=new Set<string>();
 for(let i=0;i<list.length;i++){
  const m=list[i]!;if(!m||typeof m.id!=='string'||ids.has(m.id)||!['2x2','2x6'].includes(m.type)||![0,90].includes(m.rotation)||![m.x,m.z].every(v=>Number.isFinite(v)&&Math.abs(v*10-Math.round(v*10))<1e-7))throw Error('Некорректный модуль.');ids.add(m.id);
  const r=footprint(m);for(let x=r.x1+50;x<r.x2;x+=100)for(let z=r.z1+50;z<r.z2;z+=100)if(!walkableContains(maze,x,z))throw Error('Модуль вне доступной области.');
  for(let j=0;j<i;j++){const q=footprint(list[j]!);if(Math.min(r.x2,q.x2)>Math.max(r.x1,q.x1)&&Math.min(r.z2,q.z2)>Math.max(r.z1,q.z1))throw Error('Модули пересекаются.');}
 }
}
/** Rectilinear layout regions, not the fine navigation grid. Module interiors
 * are one region even when other modules introduce additional coordinate cuts. */
const ownerCache=new WeakMap<object,Int32Array>();
export function regionOwners(maze:Maze):Int32Array{
 const found=ownerCache.get(maze.layout!);if(found)return found;
 const xs=axisCuts(maze,'x'),zs=axisCuts(maze,'z'),w=xs.length-1,result=new Int32Array(w*(zs.length-1)).fill(-1),ids=new Map(maze.layout!.modules.map((m,i)=>[m.id,i]));let next=ids.size+(maze.layout!.spaces?.filter(r=>r.kind==='hall').length??0),previous=new Map<string,number>();
 for(let z=0;z<zs.length-1;z++){
  const current=new Map<string,number>();let x=0;
  while(x<w){const p={x:(xs[x]!+xs[x+1]!)/2,z:(zs[z]!+zs[z+1]!)/2};if(!walkableContains(maze,mm(p.x),mm(p.z))){x++;continue;}const halls=maze.layout!.spaces?.filter(r=>r.kind==='hall')??[],hall=halls.findIndex(r=>p.x>r.x&&p.x<r.x+r.width&&p.z>r.z&&p.z<r.z+r.height);if(hall>=0){result[z*w+x]=ids.size+hall;x++;continue;}const id=moduleAt(maze,p);if(id){result[z*w+x]=ids.get(id)!;x++;continue;}
   const start=x;while(x<w){const q={x:(xs[x]!+xs[x+1]!)/2,z:p.z};if(!walkableContains(maze,mm(q.x),mm(q.z))||moduleAt(maze,q)||halls.some(r=>q.x>r.x&&q.x<r.x+r.width&&q.z>r.z&&q.z<r.z+r.height))break;x++;}
   const key=`${start}:${x}`,owner=previous.get(key)??next++;current.set(key,owner);for(let j=start;j<x;j++)result[z*w+j]=owner;
  }
  previous=current;
 }
 // Short corridor spaces mark real junctions along streets; a 30 m street
 // must not expose every doorway as one simultaneous twenty-way decision.
 // Cuts use existing metre coordinates and never subdivide physical modules.
 const groups=new Map<number,number[]>();for(let i=0;i<result.length;i++)if(result[i]!>=ids.size+(maze.layout!.spaces?.filter(r=>r.kind==='hall').length??0)){if(!groups.has(result[i]!))groups.set(result[i]!,[]);groups.get(result[i]!)!.push(i);}
 next=ids.size+(maze.layout!.spaces?.filter(r=>r.kind==='hall').length??0);
 for(const cells of groups.values()){
  const x1=Math.min(...cells.map(c=>xs[c%w]!)),x2=Math.max(...cells.map(c=>xs[c%w+1]!)),z1=Math.min(...cells.map(c=>zs[Math.floor(c/w)]!)),z2=Math.max(...cells.map(c=>zs[Math.floor(c/w)+1]!)),horizontal=x2-x1>=z2-z1,lo=horizontal?x1:z1,hi=horizontal?x2:z2,cuts=[lo];let at=lo;
  while(hi-at>3+1e-7){let cut=Math.round(at+2);if(cut-at<1)cut=Math.ceil(at+1);if(hi-cut<1)break;cuts.push(cut);at=cut;}cuts.push(hi);
  const start=next;next+=cuts.length-1;for(const c of cells){const v=horizontal?(xs[c%w]!+xs[c%w+1]!)/2:(zs[Math.floor(c/w)]!+zs[Math.floor(c/w)+1]!)/2;result[c]=start+cuts.findIndex((v2,i)=>i>0&&v<v2)-1;}
 }
 ownerCache.set(maze.layout!,result);return result;
}
export function mergeWalls(input:readonly Wall[]):Wall[]{
 const groups=new Map<string,{axis:'x'|'z';fixed:number;spans:[number,number][]}>();
 for(const w of input){const vertical=w.x1===w.x2,fixed=mm(vertical?w.x1:w.z1),a=mm(vertical?w.z1:w.x1),b=mm(vertical?w.z2:w.x2),key=`${vertical?'x':'z'}:${fixed}`;let g=groups.get(key);if(!g){g={axis:vertical?'x':'z',fixed,spans:[]};groups.set(key,g);}g.spans.push([Math.min(a,b),Math.max(a,b)]);}
 const result:Wall[]=[];for(const g of groups.values()){g.spans.sort((a,b)=>a[0]-b[0]);const merged:[number,number][]=[];for(const s of g.spans){const last=merged.at(-1);if(last&&s[0]<=last[1])last[1]=Math.max(last[1],s[1]);else merged.push([...s]);}for(const [a,b]of merged)result.push(g.axis==='x'?{x1:metres(g.fixed),z1:metres(a),x2:metres(g.fixed),z2:metres(b)}:{x1:metres(a),z1:metres(g.fixed),x2:metres(b),z2:metres(g.fixed)});}
 return result.sort((a,b)=>a.x1-b.x1||a.z1-b.z1||a.x2-b.x2||a.z2-b.z2);
}
export function footprintSummary(p:Parameters):{area:number;connected:boolean}{
 const xs=[...new Set([0,mm(p.columns),...(p.shape?.rectangles.flatMap(r=>[mm(r.x),mm(r.x+r.width)])??[])])].sort((a,b)=>a-b),zs=[...new Set([0,mm(p.rows),...(p.shape?.rectangles.flatMap(r=>[mm(r.z),mm(r.z+r.height)])??[])])].sort((a,b)=>a-b),w=xs.length-1,active=new Set<number>();let area=0;
 for(let z=0;z<zs.length-1;z++)for(let x=0;x<w;x++)if(footprintContains(p,(xs[x]!+xs[x+1]!)/2,(zs[z]!+zs[z+1]!)/2)){active.add(z*w+x);area+=(xs[x+1]!-xs[x]!)*(zs[z+1]!-zs[z]!)/1e6;}
 const first=active.values().next().value;if(first===undefined)return {area:0,connected:false};const seen=new Set([first]),q=[first];for(let i=0;i<q.length;i++){const c=q[i]!,x=c%w;for(const n of [x?c-1:-1,x<w-1?c+1:-1,c-w,c+w])if(active.has(n)&&!seen.has(n)){seen.add(n);q.push(n);}}
 return {area,connected:seen.size===active.size};
}
