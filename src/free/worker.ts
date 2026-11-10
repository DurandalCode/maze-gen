import { generateFree } from './generate';
import { analyzeFree, checkFreeQuality } from './quality';
import { freeMaze, validateFree } from './layout';
import { mazeDraft } from './json';
import { random } from '../core/random';
import type { Maze, Parameters } from '../core/maze';
self.onmessage = (event: MessageEvent<{ kind: 'generate' | 'analyze' | 'improve'; parameters: Parameters; maze?: Maze; profile?: 'explorer' | 'compass' | 'outline' }>) => {
  try {
    const q = event.data;
    if (q.kind === 'generate') self.postMessage({ maze: generateFree(q.parameters, q.maze, progress => self.postMessage({ progress })) }); else if (q.kind === 'analyze') self.postMessage({ analysis: analyzeFree(q.maze!, 256, q.profile) }); else {
      const original = q.maze!, rng = random(original.parameters.seed + ':improve'), start = performance.now();
      let best = original;
      const score = (m: Maze) => Math.max(...(['explorer', 'compass', 'outline'] as const).map(p => analyzeFree(m, 256, p).coldAreaRatio));
      let bestScore = score(best);
      for (let i = 0; i < 96 && performance.now() - start < 20000; i++) {
        self.postMessage({ progress: `Улучшение размещения: ${i + 1}/96` });
        const d = mazeDraft(best);
        for (const m of d.layout.modules) {
          m.x += (rng() - .5) * .2;
          m.z += (rng() - .5) * .2;
          m.angle += (rng() - .5) * 2;
        }
        if (validateFree(d).length) continue;
        const candidate = freeMaze(d, false);
        if (checkFreeQuality(candidate).length) continue;
        const value = score(candidate);
        if (value < bestScore) {
          best = candidate;
          bestScore = value;
        }
      }
      self.postMessage({ maze: best, improved: best !== original });
    }
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
