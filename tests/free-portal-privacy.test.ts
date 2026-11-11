import {expect,test} from 'bun:test';
import {freePrivacyFixture} from './fixtures/free-privacy';
import {portalPrivacy} from '../src/analysis/portal-privacy';
import {freeRuntime,freeMaze,anchorGeometry} from '../src/free/layout';
import {removeFreePanel} from '../src/free/wall-removal';
import {mazeDraft} from '../src/free/json';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {segmentDistance} from '../src/free/geometry';
test('v5 continuously certifies the full width of an occluded terminal pocket',()=>{
 const m=freePrivacyFixture(),p=portalPrivacy(m,m.entrance);expect(m.version).toBe(5);expect(p.certified).toBe(true);expect(p.pocket).toEqual([8,4,5]);expect(p.gates).toHaveLength(1);expect(p.blockers).toHaveLength(1);expect(p.witness).toBeUndefined();expect(portalPrivacy({...m,translucentFabric:false},m.entrance).certified).toBe(true);expect(portalPrivacy(deserialize(serialize(m)),m.entrance).certified).toBe(true);
});
test('removing the real v5 shielding panel invalidates privacy and produces a visible aperture witness',()=>{
 const m=freePrivacyFixture(),r=freeRuntime(m),a=r.centers[8]!,b=r.centers[9]!,mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2},index=r.panels.findIndex(w=>segmentDistance(mid,w)<1e-7),after=removeFreePanel(m,index),p=portalPrivacy(after,after.entrance);expect(p.certified).toBe(false);expect(p.witness).toBeDefined();expect(p.pocket).not.toContain(p.witness!.cell);
});
test('v5 never certifies an unproven pocket and validates free portal references',()=>{
 const m=freePrivacyFixture(),p=portalPrivacy(m,m.exit,1,false);expect(p.certified).toBe(false);expect(p.witness).toBeUndefined();expect(p.reason).toContain('не доказана');expect(()=>portalPrivacy(m,{cell:5,side:'north'})).toThrow();expect(()=>portalPrivacy(m,m.entrance,0)).toThrow();
});
test('another physical v5 opening inside the pocket prevents certification',()=>{
 const m=freePrivacyFixture(),d=mazeDraft(m),opening={id:'extra',room:'room-4',edge:3,offset:0,width:2},g=anchorGeometry(d.layout,opening,2);d.layout.openings.push(opening);d.layout.preservedPanels=d.layout.preservedPanels!.filter(w=>segmentDistance(g.mid,w)>1e-7);const after=freeMaze(d);expect(portalPrivacy(after,after.entrance).certified).toBe(false);
});
test('native v5 certificates are invariant under all four rotations',()=>{
 for(const angle of [0,90,180,270]){const m=freePrivacyFixture(angle);expect(portalPrivacy(m,m.entrance).certified).toBe(true);}
});

test('v7 uses the same physical gate model and never certifies a bridge pocket as planar',async()=>{const {bridgeFixture}=await import('./fixtures/free-bridge'),m=freeMaze(bridgeFixture()),p=portalPrivacy(m,m.entrance,3,false);expect(m.version).toBe(7);expect(p.portal.freeId).toBe(m.free!.entrance);expect(p.gates).toHaveLength(2);expect(p.certified).toBe(false);expect(deserialize(serialize(m)).version).toBe(7);});
