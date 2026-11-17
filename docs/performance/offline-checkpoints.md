# Offline checkpoint stalls on the embedded distribution

The95f3b3f Tauri path rebuilt a free maze repeatedly for each checkpoint:
`validateWalk → saveOfflineMaze → restoreRecord(old maze) → assessWalk →
restoreRecord(old walk)`. These synchronous operations ran on the UI thread.
The10-second interval and the immediate F checkpoint used the same path.

On the actual embedded03-free-hybrid, a real Player recording with134/801
samples at10/60s took3.15/4.41s per `saveOfflineWalk` in Bun/fake IndexedDB.
Individual map validation took about1s. Serialization, cloning and IDs each
took under2ms. The corresponding04 and05 revision02 saves were1.22/2.43s at60s.
These are measurements on macOS, not physical Windows/WebView2 measurements.

The fix validates and assesses an incoming wire snapshot once, in one shared
module worker. The main thread commits prepared wire data in short IndexedDB
transactions. Atomic comparisons use only the old stored metadata; they do
not reconstruct its maze. Complete/elapsed/stopped/F-marker ordering remains
inside the read-write transaction. The returned record still has a runtime
maze. Pending localStorage backups are cleared only after the write succeeds,
as before. Worker unavailability or startup failure uses the same full
validator as a fallback; validation errors reject and leave the backup queued.

A controlled browser comparison used actual embedded03, `isTauri=true`, a
fresh test IndexedDB and real RAF-driven Player movement for23.5 wall seconds:

| | Baseline offline module | Worker preparation |
|---|---:|---:|
| Long tasks while walking |11|0|
| Largest frame gap |1900ms|16.8ms|
| Recorded movement time |17.43s|23.50s|
| Distance |24.4m|32.9m|
| F markers |1|1|

The baseline lost movement time because long tasks exceeded the existing
0.25s pause guard. The worker took0.78–1.02s to prepare a save, while the page
continued at60FPS. Periodic, F and terminal checkpoints were saved, with a
stopped record and assessment. The same no-worker Bun path also improved:
03 saves became1.27/1.56s at10/60s by eliminating redundant reconstruction.

## Reproduction

Start a temporary Vite server from this checkout, with a separate port. The
profiler uses a fresh browser context and a dedicated test IndexedDB, never
HTTP map/walk writes or the user's library:

```sh
bun --bun vite --host 127.0.0.1 --port 1460 --strictPort
MAZE_TEST_URL=http://127.0.0.1:1460 bun scripts/profile-offline-checkpoints.ts
MAZE_TEST_URL=http://127.0.0.1:1460 MAZE_PROFILE_LEGACY=1 bun scripts/profile-offline-checkpoints.ts
```

`MAZE_BROWSER` overrides the browser executable. The optional legacy
profile reads the baseline module from Git95f3b3f and serves a test-only copy
through a Playwright route; production source files are not changed. JSON
reports are written under `MAZE_OUTPUT_DIR` or `test-results`.

The profiler is a **dev-server** harness: it patches the actual Player module
through `/src/` imports to follow its real doorway path without teleporting.
It cannot be pointed unchanged at a built server with no `/src/` endpoints.
Production integration must additionally check the built worker URL under the
Tauri CSP; this lane did not run a Windows binary. The current CSP's self-only
script policy is inherited by workers when `worker-src` is absent.

Startup still has long validation/seeding tasks (up to1.3s in the measured
browser). This fix does not remove startup validation or claim to solve every
renderer/GPU/collision issue. No embedded map geometry, recording interval,
assessment algorithm or saved format was changed.
