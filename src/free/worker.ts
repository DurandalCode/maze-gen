import { generateFree } from './generate';
import { analyzeFree } from './quality';
import {optimizeFree} from './optimize';
import type { Maze, Parameters } from '../core/maze';
self.onmessage = (event: MessageEvent<{ kind: 'generate' | 'analyze' | 'improve'; parameters: Parameters; maze?: Maze; profile?: 'explorer' | 'compass' | 'outline' }>) => {
  try {
    const q = event.data;
    if (q.kind === 'generate') self.postMessage({ maze: generateFree(q.parameters, q.maze, progress => self.postMessage({ progress })) }); else if (q.kind === 'analyze') self.postMessage({ analysis: analyzeFree(q.maze!, 256, q.profile) }); else {
      const result=optimizeFree(q.maze!,96,256,(done,total)=>self.postMessage({progress:`Улучшение размещения: ${done}/${total}`}));
      self.postMessage(result);
    }
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
