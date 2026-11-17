import type {Point} from '../core/maze';

export interface Box {x1:number;z1:number;x2:number;z2:number}
const MAX_CELLS=4096;
const finiteBox=(b:Box)=>[b.x1,b.z1,b.x2,b.z2].every(Number.isFinite)&&b.x1<=b.x2&&b.z1<=b.z2;
const overlaps=(a:Box,b:Box)=>!finiteBox(a)||!finiteBox(b)||(a.x1<=b.x2&&a.x2>=b.x1&&a.z1<=b.z2&&a.z2>=b.z1);
/** Conservative broad phase owned by one physical snapshot, never a layout-keyed
 * cache. Editing/rebuilding geometry constructs a fresh index. Exact predicates
 * remain the caller's responsibility; output order matches the original array. */
export class SpatialIndex<T> {
  private buckets=new Map<string,number[]>();
  private boxes:Box[];
  private overflow:number[]=[];
  /** Invalid editor drafts and long rays must never expand an unbounded grid. */
  private cells(b:Box):[number,number,number,number]|null{
    if(!finiteBox(b)||!Number.isFinite(this.size)||this.size<=0)return null;
    const x1=Math.floor(b.x1/this.size),x2=Math.floor(b.x2/this.size),z1=Math.floor(b.z1/this.size),z2=Math.floor(b.z2/this.size);
    if(![x1,x2,z1,z2].every(Number.isSafeInteger))return null;
    const width=x2-x1+1,height=z2-z1+1;
    return width>0&&height>0&&width<=MAX_CELLS&&height<=MAX_CELLS&&width*height<=MAX_CELLS?[x1,x2,z1,z2]:null;
  }
  constructor(private values:readonly T[],box:(value:T)=>Box,private size=4){
    this.boxes=values.map(box);
    this.boxes.forEach((b,i)=>{
      const cells=this.cells(b);
      if(!cells){this.overflow.push(i);return;}
      const [x1,x2,z1,z2]=cells;
      for(let x=x1;x<=x2;x++)
        for(let z=z1;z<=z2;z++){
          const key=`${x},${z}`,list=this.buckets.get(key)??[];list.push(i);this.buckets.set(key,list);
        }
    });
  }
  query(b:Box):T[]{
    const cells=this.cells(b);
    // Unsafe queries conservatively retain all possible exact-predicate inputs;
    // large finite queries use bounded O(objects) AABB filtering instead of cells.
    if(!cells)return this.values.filter((_,i)=>overlaps(this.boxes[i]!,b));
    const seen=new Set<number>(this.overflow.filter(i=>overlaps(this.boxes[i]!,b)));
    const [x1,x2,z1,z2]=cells;
    for(let x=x1;x<=x2;x++)
      for(let z=z1;z<=z2;z++)
        for(const i of this.buckets.get(`${x},${z}`)??[]){
          const a=this.boxes[i]!;
          if(a.x1<=b.x2&&a.x2>=b.x1&&a.z1<=b.z2&&a.z2>=b.z1)seen.add(i);
        }
    return [...seen].sort((a,b)=>a-b).map(i=>this.values[i]!);
  }
  at(p:Point):T[]{return this.query({x1:p.x,z1:p.z,x2:p.x,z2:p.z});}
}
