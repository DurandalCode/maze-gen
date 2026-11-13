# K1: alternate approach experiment

This is an explicit deterministic edit of the saved vortex10,
`2520a9bd43b8839ff40cf76e`, not another seed generation. The input is cloned.
The external entrance/exit, all courtyard polygons, K2 and all other original
frame poses stay unchanged. Two K1 frames (`spiral3-3`, `spiral3-4`) move0.45m
in negativeZ. Three genuine frames are added: two2×6 and one2×2. Seven old
connections are replaced with nine new/reseated native connections.

The real entrance-to-exit route changes from
`spiral1-17 → spiral1-16 → spiral2-10` to
`spiral0-23 → spiral1-16 → spiral1-17`.

The local cut/reconnection also changes the false circuit: it becomes45.61m,
with physical inward excursion11.54m and no interior branches. The former outer
return tail is now a dead-end branch before K1. The arm-ID transition report
contains two inward transitions rather than three; the actual minimum radius
is8.41m. These changes make this an approach experiment with a modified circuit,
not a geometrically isolated change of arrival direction. Trap formulas and
thresholds are unchanged; model qualification is not a claim about human play.

```sh
K1_BASE_FILE=/path/to/vortex-hybrid-10.json \
VORTEX_OUTPUT_DIR=test-results bun scripts/prepare-vortex-k1-ab.ts
```

The script verifies the original physical identity, capsule paths, Player tours,
actual route and deterministic transformation, then saves a new library record
`К1 · другой подход`. Output JSON and a full changed-module/connection report
use `vortex-k1-other-approach` filenames. The new geometry is preserved by native
JSON import/export. Ordinary seed regeneration restores the original10 recipe;
repeat this explicit transformation to reproduce the experiment.

For the ordinary saved-map browser smoke, set `VORTEX_AB_EDIT=1` together with
`MAZE_BASE_URL` and `MAZE_GEOMETRY_ID` when running
`scripts/vortex-hybrid-deep-browser-check.ts`. The smoke does not regenerate the
map or write a real walkthrough.
