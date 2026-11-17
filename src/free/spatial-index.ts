import type {Point} from '../core/maze';

export interface Box {x1:number;z1:number;x2:number;z2:number}
/** Conservative broad phase owned by one physical snapshot, never a layout-keyed
 * cache. Editing/rebuilding geometry constructs a fresh index. Exact predicates
 * remain the caller's responsibility; output order matches the original array. */
export class SpatialIndex<T> {
  private buckets=new Map<string,number[]>();
  private boxes:Box[];
  constructor(private values:readonly T[],box:(value:T)=>Box,private size=4){
    this.boxes=values.map(box);
    this.boxes.forEach((b,i)=>{
      for(let x=Math.floor(b.x1/size);x<=Math.floor(b.x2/size);x++)
        for(let z=Math.floor(b.z1/size);z<=Math.floor(b.z2/size);z++){
          const key=`${x},${z}`,list=this.buckets.get(key)??[];list.push(i);this.buckets.set(key,list);
        }
    });
  }
  query(b:Box):T[]{
    const seen=new Set<number>();
    for(let x=Math.floor(b.x1/this.size);x<=Math.floor(b.x2/this.size);x++)
      for(let z=Math.floor(b.z1/this.size);z<=Math.floor(b.z2/this.size);z++)
        for(const i of this.buckets.get(`${x},${z}`)??[]){
          const a=this.boxes[i]!;
          if(a.x1<=b.x2&&a.x2>=b.x1&&a.z1<=b.z2&&a.z2>=b.z1)seen.add(i);
        }
    return [...seen].sort((a,b)=>a-b).map(i=>this.values[i]!);
  }
  at(p:Point):T[]{return this.query({x1:p.x,z1:p.z,x2:p.x,z2:p.z});}
}
