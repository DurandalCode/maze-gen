import{expect,test}from'bun:test';
import{pointLocator,cellAtPoint}from'../src/analysis/navigation';
import{emptyLayout,type FreeDraft}from'../src/free/model';
import{freeMaze,validateFree,connectionGeometry}from'../src/free/layout';
import{DEFAULT_CONSTRUCTION}from'../src/core/maze';
import{random}from'../src/core/random';

test('free spatial lookup preserves room, boundary and connector precedence for rotated geometry and holes',()=>{
 const l=emptyLayout(),angle=37,rad=angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);l.modules=[0,1,2].map(i=>({id:`m${i}`,type:'2x2',x:12+i*5*c,z:12+i*5*s,angle}));l.connections=[0,1].map(i=>({id:`link${i}`,a:{room:`m${i}`,edge:1,offset:0},b:{room:`m${i+1}`,edge:3,offset:0},width:1.8}));l.openings=[{id:'in',room:'m0',edge:3,offset:0,width:1.4},{id:'out',room:'m2',edge:1,offset:0,width:1.4}];l.entrance='in';l.exit='out';
 const d:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:40,rows:40,moduleSize:2,corridorWidth:2,extraConnections:0,seed:'locator',algorithm:'prim'},construction:DEFAULT_CONSTRUCTION,layout:l};expect(validateFree(d)).toEqual([]);const maze=freeMaze(d,false),locate=pointLocator(maze),rng=random('locations');
 const points=[...l.modules.map(m=>({x:m.x,z:m.z})),...l.connections.flatMap(link=>{const g=connectionGeometry(l,link);return[g.a.mid,g.b.mid,g.a.from,g.b.to,{x:(g.a.mid.x+g.b.mid.x)/2,z:(g.a.mid.z+g.b.mid.z)/2}];}),...Array.from({length:250},()=>({x:8+rng()*20,z:8+rng()*20}))];
 for(const p of points)expect(locate(p)).toBe(cellAtPoint(maze,p));
 // Native polygon holes use the same strict interior exclusion.
 l.spaces.push({id:'yard',kind:'hall',polygon:[{x:2,z:2},{x:8,z:2},{x:8,z:8},{x:2,z:8}],holes:[[{x:4,z:4},{x:6,z:4},{x:6,z:6},{x:4,z:6}]]});const withHole=freeMaze(d,false),holeLookup=pointLocator(withHole);for(const p of [{x:3,z:3},{x:5,z:5},{x:4,z:5},{x:2,z:2},{x:-.1,z:0}])expect(holeLookup(p)).toBe(cellAtPoint(withHole,p));
});

test('bridge-tagged positions retain the v7 lookup and lower crossings remain separate',async()=>{
 const {bridgeFixture}=await import('./fixtures/free-bridge');const maze=freeMaze(bridgeFixture(),false),locate=pointLocator(maze);
 for(const x of [4,8,13,18,22])for(const bridge of [undefined,'bridge-1']){const point={x,z:15,...(bridge?{bridge,y:2.8}:{})};expect(locate(point)).toBe(cellAtPoint(maze,point));}
});
