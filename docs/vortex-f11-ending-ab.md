# F11 ending A/B

This is an explicit deterministic local edit of saved map
`be6cd4266cc1c2d6dfae4a81`, not another generation. Original frames, courtyard
polygons, outer entrance/exit positions, parameters and both qualified return
circuits stay unchanged. No walkthrough or F-marker data is copied or edited.

One real2×2 frame at(22.9,14.5), rotated45°, joins the existing upper side
branch to the original exit. The direct `spiral0-16 ↔ spiral3-23` passage is
closed; the correct final route becomes
`spiral1-10 → bay19-446 → bay19-1162 → new turning frame → spiral3-23`.
The old apparently direct finish approach becomes a false lead. The same
external exit is reached after a concealed turn, with an initially less direct
choice. This is a local hypothesis for play, not a predicted human trap rating.

The bounded short-loop trial did not fit under the original constraints. No
new ring is claimed and no40m requirement or trap formula was changed. Existing
Л2/К2 remain qualified; this version adds one changed final choice.

```sh
F11_BASE_FILE=/path/to/vortex-new-f-11.json \
VORTEX_OUTPUT_DIR=test-results bun scripts/publish-vortex-f11-ending.ts
```

The publisher derives the geometry through `vortexF11Ending`, verifies the
source physical identity, native validation, capsule segments, real Player
finish, unchanged qualified traps,8/64 bounds and native JSON, then posts only a
new map record through the existing1428 API. It never starts/restarts a server
or writes walks. The intro check opens the new link without starting play and
asserts that the walkthrough library remains unchanged, with F help visible.

This manual A/B edit survives native JSON import/export. Ordinary regeneration
by the saved original seed restores the original F11; repeat the explicit
transformation to reproduce this ending. The regression fixture contains only
the original native map, without the player's recording or direction markers.
