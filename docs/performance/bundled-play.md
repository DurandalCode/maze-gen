# Bundled maps 03–05: walking performance

The reported priority case is `distribution-v2/03-free-hybrid.json`; maps 04 and
05 (`05-free-bridges-revision02.json`, selected by the manifest) are also covered.
The bundled JSON, construction and player radius are unchanged.

## Confirmed fixes

- Offline checkpoints and F previously rebuilt the same free maze several times
  on the UI thread. One private module worker now performs the full validation,
  identity calculation and walk assessment once. IndexedDB commits compare raw
  recording metadata atomically, retaining terminal-state and marker ordering.
  Pending local backups remain until a successful commit. Worker-unavailable
  fallback uses the same complete validator.
- Floor containment and clipping use a conservative snapshot-owned spatial index
  followed by the original exact predicates. Oversized/invalid bucket ranges
  fall back to a bounded object scan; editing builds a new physical snapshot.
- Directional shadows are redrawn when the existing half-metre following region,
  height, maze or graphics context changes. Looking around a static scene reuses
  the same shadow image.
- Large opaque instance groups are divided into spatially bounded batches for
  ordinary frustum culling. Transparent fabric retains its global ordering.
  Bridge scenes retain their previous opaque ordering at coincident joints.
- The walk introduction/pause screen offers **Сниженная нагрузка на графику**.
  This explicit option halves internal pixel ratio and disables offscreen MSAA;
  geometry, fabric shading, lighting, roofs and collisions stay enabled. Normal
  quality remains the default. Changing quality preserves position and recording.

## Evidence and limits

On the same actual embedded map 03 and 23.5-second browser walk, the old offline
save path caused 11 long tasks and a maximum frame of 1900 ms. The fixed worker
path had no walking long tasks and a maximum frame of 16.8 ms. The saved movement
time increased from 17.43 to 23.50 seconds because long stalls no longer caused
the walk's interruption/pause guard to discard active time. F and the terminal
recording were retained. A production build was additionally checked under the
desktop application's CSP with real IndexedDB writes.

Software ANGLE/SwiftShader reproduces a separate GPU bottleneck. It is **not a
measurement on a Windows PC**. For map 03 at 1280×724, representative median
visible-frame times were approximately 170 ms originally, 117 ms with shadow
reuse/spatial opaque batches, and 50 ms with the explicit reduced graphics
profile. The last figure is around 20 FPS, not a promise of 30/60 FPS on software
rendering. Hardware-accelerated and software runs must be reported separately.

Targeted geometry, bridges, storage ordering, F, renderer bounds and quality
tests pass (60 tests across 14 files). Full-render comparison retained every
RGBA channel for the tested views of maps 03, 04 and 05. Physical Windows and
Android validation and the full repository test suite were not run for this fix.
Initial map validation can still take roughly a second before walking starts.

## Reproduce

`scripts/profile-offline-checkpoints.ts` runs the before/after offline movement
profile against Vite, using isolated IndexedDB. Set `MAZE_PROFILE_LEGACY=1` for
the original offline module from commit `95f3b3f`.

`scripts/bundle-play-profile.ts` profiles idle, look, movement and interior views
against Vite. Set `MAZE_SOFTWARE_GL=1` to force SwiftShader,
`MAZE_LOW_GRAPHICS=1` for the reduced profile, and `MAZE_MAPS=03` to select only
map 03. Report the returned renderer string with timings. The final OutputPass
draw-call field is not the total scene/shadow draw-call count.

`scripts/bundle-checkpoint-production.ts` checks a production server with the
desktop CSP: actual movement, F, periodic saves, graphics changes during pause,
terminal recording and an empty pending queue. All browser scripts support
`MAZE_TEST_URL` and `MAZE_BROWSER`; outputs are diagnostic artifacts, not live
player recordings.
