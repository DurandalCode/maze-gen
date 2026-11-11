import { useEffect, useRef, useState } from 'react';
import type { PreparedWorld } from '../jobs/compute';
import { WorldScene } from '../renderer/scene';
import { PlanRenderer } from '../renderer/plan';
import { message } from './services';

export function WorldView({
  world,
  initialMode = '2d',
}: {
  world: PreparedWorld;
  initialMode?: '2d' | '3d';
}) {
  const [mode, setMode] = useState<'2d' | '3d'>(initialMode);
  const [error, setError] = useState('');
  const [lost, setLost] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<WorldScene | null>(null);
  useEffect(() => {
    setError('');
    setLost(false);
    let dispose = () => {};
    try {
      if (mode === '2d') {
        const plan = new PlanRenderer(canvas.current!);
        dispose = () => plan.dispose();
        plan.setWorld(world.physical);
      } else {
        const view = new WorldScene(canvas.current!, (state) => {
          setLost(state === 'lost');
          if (state === 'restored') view.start();
        });
        scene.current = view;
        dispose = () => {
          view.dispose();
          scene.current = null;
        };
        view.setWorld(world);
        view.start();
      }
    } catch (e) {
      dispose();
      setError(message(e));
    }
    return dispose;
  }, [world, mode]);
  return (
    <>
      <div className="toolbar" role="group" aria-label="Вид карты">
        <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>
          План 2D
        </button>
        <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>
          Сцена 3D
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {lost && (
        <p role="alert">
          Графическая сцена приостановлена.{' '}
          <button onClick={() => scene.current?.restore()}>Восстановить сцену</button>
        </p>
      )}
      <canvas
        key={mode}
        ref={canvas}
        className="world-canvas"
        aria-label={mode === '2d' ? 'План лабиринта' : 'Трёхмерный лабиринт'}
      />
      <dl className="metrics">
        <div>
          <dt>Площадь пола</dt>
          <dd>{world.metrics.floorM2.toFixed(1)} м²</dd>
        </div>
        <div>
          <dt>Опорный маршрут</dt>
          <dd>{world.metrics.routeLengthM.toFixed(1)} м</dd>
        </div>
        <div>
          <dt>Циклы</dt>
          <dd>{world.metrics.cycles}</dd>
        </div>
        <div>
          <dt>Развилки</dt>
          <dd>{world.metrics.decisionCount}</dd>
        </div>
      </dl>
    </>
  );
}
