import {sideDistricts} from './side-districts';
import {analyzePotential} from './potential-difficulty';
import { expectedExploration } from './expected-exploration';
import { decisionDifficulty } from './decision-difficulty';
import { metrics } from '../core/metrics';
import { analyzeColdspots, type AnalysisOptions } from './coldspots';
import { optimizeColdspots, type OptimizationMethod, type OptimizationObjective } from './optimize';
import type { Maze } from '../core/maze';
type Request = {
  kind: 'analyze';
  maze: Maze;
  options: AnalysisOptions;
} | {
  kind: 'optimize';
  maze: Maze;
  options: AnalysisOptions;
  method: OptimizationMethod;
  objective?:OptimizationObjective;
  attempts: number;
};
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const request = event.data;
    if (request.kind === 'analyze') {
      const result = analyzeColdspots(request.maze, request.options);
      result.potential=analyzePotential(request.maze,request.maze.parameters.design?{...request.options,samples:2048}:request.options,result);
      result.sideDistricts=sideDistricts(request.maze,result.probability,result.options.threshold);
      result.privacy = result.potential.privacy;
      if (request.maze.version!==4&&metrics(request.maze).cycles === 0)
        result.sideExploration = expectedExploration(request.maze, result.probability);
      if (request.maze.version!==4&&request.options.profile === 'outline' && metrics(request.maze).cycles === 0)
        result.decisions = decisionDifficulty(request.maze);
      result.explorerExpectedLength = request.options.profile === 'explorer' ? result.expectedLength :
        analyzeColdspots(request.maze, { ...request.options, profile: 'explorer' }).expectedLength;
      self.postMessage({ kind: 'analysis', result });
    }
    else
      self.postMessage({ kind: 'optimized', result: optimizeColdspots(request.maze, request.options, request.method, request.attempts, (done, total) => self.postMessage({ kind: 'progress', done, total }),request.objective??'coldspots') });
  }
  catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
