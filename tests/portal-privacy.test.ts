import { expect, test } from 'bun:test';
import { emptyMaze, connect } from '../src/core/maze';
import { portalPrivacy } from '../src/analysis/portal-privacy';
function fixture() { const m = emptyMaze({ columns: 4, rows: 3, corridorWidth: 2, algorithm: 'prim', seed: 'privacy', extraConnections: 0 }); for (const [a, b] of [[8, 4], [4, 5], [5, 9], [0, 1], [1, 2], [2, 3], [3, 7], [7, 6], [6, 10], [10, 11], [10, 9]])
  connect(m, a!, b!); m.entrance = { cell: 8, side: 'south' }; m.exit = { cell: 3, side: 'north' }; return m; }
test('continuous aperture-to-gate certificate accepts an occluded terminal pocket', () => {
  const m = fixture(), r = portalPrivacy(m, m.entrance);
  expect(r.certified).toBe(true);
  expect(r.pocket).toEqual([8, 4, 5]);
  expect(r.gates).toHaveLength(1);
  expect(r.blockers).toHaveLength(1);
  expect(r.witness).toBeUndefined();
  const dark = { ...m, translucentFabric: false };
  expect(portalPrivacy(dark, dark.entrance).certified).toBe(true);
});
test('opening the shielding wall invalidates the certificate and supplies a real visible witness', () => {
  const m = fixture();
  connect(m, 8, 9);
  const r = portalPrivacy(m, m.entrance);
  expect(r.certified).toBe(false);
  expect(r.witness).toBeDefined();
  expect(r.pocket).not.toContain(r.witness!.cell);
});
test('proof is conservative and does not declare unproven layouts invisible', () => {
  const m = fixture(), r = portalPrivacy(m, m.exit, 1, false);
  expect(r.certified).toBe(false);
  expect(r.witness).toBeUndefined();
  expect(r.reason).toContain('не доказана');
  expect(() => portalPrivacy(m, { cell: 5, side: 'north' })).toThrow();
  expect(() => portalPrivacy(m, m.entrance, 0)).toThrow();
});
test('a second opening inside a pocket cannot bypass the visibility gate', () => {
  const m = fixture();
  m.portals = [m.entrance, m.exit, { cell: 4, side: 'west' }];
  expect(portalPrivacy(m, m.entrance).certified).toBe(false);
});

test('continuous occlusion certificates are invariant under all four rotations',()=>{
 let m=fixture();const turn={north:'east',east:'south',south:'west',west:'north'} as const;
 for(let rotation=0;rotation<4;rotation++){
  expect(portalPrivacy(m,m.entrance).certified).toBe(true);
  const columns=m.parameters.columns,rows=m.parameters.rows,map=(cell:number)=>(cell%columns)*rows+(rows-1-Math.floor(cell/columns));
  const next=emptyMaze({...m.parameters,columns:rows,rows:columns});
  for(let c=0;c<m.passages.length;c++)next.passages[map(c)]=m.passages[c]!.map(map);
  next.entrance={cell:map(m.entrance.cell),side:turn[m.entrance.side]};next.exit={cell:map(m.exit.cell),side:turn[m.exit.side]};m=next;
 }
});
