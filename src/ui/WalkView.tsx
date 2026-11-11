import { useEffect, useRef, useState } from 'react';
import type { PreparedWorld } from '../jobs/compute';
import type { Session } from '../session/types';
import { Recorder } from '../session/recorder';
import type { RecorderStatus } from '../session/recorder';
import { MovementController } from '../session/movement/controller';
import { attachSessionLifecycle } from '../platform/session-lifecycle';
import { WorldScene } from '../renderer/scene';
import { store, message } from './services';

export const stateLabels: Record<Session['state'], string> = {
  prepared: 'Готово к старту',
  running: 'Прохождение',
  paused: 'Пауза',
  interrupted: 'Прервано',
  finished: 'Финиш',
  stopped: 'Остановлено',
};
export function WalkView({
  world,
  session,
  onClose,
}: {
  world: PreparedWorld;
  session: Session;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<{
    recorder: Recorder;
    movement: MovementController;
    scene: WorldScene;
    keys: Set<string>;
    yaw: number;
    pitch: number;
  } | null>(null);
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [error, setError] = useState('');
  const [lost, setLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [clock, setClock] = useState({
    elapsedMs: session.elapsedMs,
    distanceM: session.distanceM,
  });
  useEffect(() => {
    let mounted = true;
    const nav = world.navigation,
      profile = world.physical.document.physicalProfile;
    const opening = world.physical.openPassages.find((o) => o.role === 'entrance')!;
    const pose = session.lastSample ?? {
      ...nav.entrance,
      y: profile.eyeHeightM,
      yaw: Math.atan2(-opening.normal.x, opening.normal.z),
      pitch: 0,
      inputMode: session.condition.inputMode,
    };
    const movement = new MovementController(
      nav.collision,
      { x: pose.x, z: pose.z },
      profile.playerRadiusM,
    );
    movement.activeTimeMs = session.elapsedMs;
    movement.distanceM = session.distanceM;
    const reportError = (e: unknown) => {
      if (mounted) setError(message(e));
    };
    const pauseMovement = () => {
      movement.setPaused(true);
      engine.current?.keys.clear();
    };
    const recorder = new Recorder(
      session,
      {
        append: (chunk) => store('append', { chunk }),
        transition: (state) =>
          store('save', { kind: 'session-state', sessionId: session.sessionId, state }),
        finalize: (state, lastSequence) =>
          store('finalize', { sessionId: session.sessionId, state, lastSequence }),
      },
      pose,
      (s) => {
        if (s.state !== 'running') pauseMovement();
        if (mounted) setStatus(s);
      },
    );
    setStatus(recorder.status());
    let scene: WorldScene;
    try {
      scene = new WorldScene(canvas.current!, (state) => {
        if (!mounted) return;
        setLost(state === 'lost');
        pauseMovement();
        void recorder.pause().catch(reportError);
        if (state === 'restored') scene.start(frame);
      });
    } catch (e) {
      reportError(e);
      return;
    }
    const e = {
      recorder,
      movement,
      scene,
      keys: new Set<string>(),
      yaw: pose.yaw,
      pitch: pose.pitch,
    };
    engine.current = e;
    let finishing = false;
    let contactYaw = pose.yaw;
    const setPose = () =>
      scene.setPose({
        position: { ...movement.position, y: profile.eyeHeightM },
        yaw: -e.yaw,
        pitch: e.pitch,
      });
    const frame = (dt: number) => {
      movement.frame(
        dt,
        {
          forward:
            Number(e.keys.has('KeyW') || e.keys.has('ArrowUp')) -
            Number(e.keys.has('KeyS') || e.keys.has('ArrowDown')),
          strafe: Number(e.keys.has('KeyD')) - Number(e.keys.has('KeyA')),
          yaw: e.yaw,
          running: session.condition.speedMps === 2.8,
        },
        (p, distanceM) => {
          recorder.step(
            1000 / 60,
            {
              ...p,
              y: profile.eyeHeightM,
              yaw: e.yaw,
              pitch: e.pitch,
              inputMode: session.condition.inputMode,
            },
            distanceM,
          );
          if (!finishing && Math.hypot(p.x - nav.exit.x, p.z - nav.exit.z) <= 0.28) {
            finishing = true;
            pauseMovement();
            void recorder
              .finish()
              .catch(reportError)
              .finally(() => {
                finishing = false;
              });
          }
        },
      );
      if (!movement.paused)
        e.yaw += (Number(e.keys.has('ArrowRight')) - Number(e.keys.has('ArrowLeft'))) * dt * 1.5;
      e.yaw = Math.atan2(Math.sin(e.yaw), Math.cos(e.yaw));
      if (
        !movement.paused &&
        movement.contacting &&
        Math.abs(Math.atan2(Math.sin(e.yaw - contactYaw), Math.cos(e.yaw - contactYaw))) >= 0.05
      ) {
        recorder.contactTurn({
          ...movement.position,
          y: profile.eyeHeightM,
          yaw: e.yaw,
          pitch: e.pitch,
          inputMode: session.condition.inputMode,
        });
        contactYaw = e.yaw;
      }
      setPose();
    };
    try {
      scene.setWorld(world);
      setPose();
      scene.start(frame);
    } catch (error) {
      scene.dispose();
      engine.current = null;
      reportError(error);
      return;
    }
    const pause = () => {
      pauseMovement();
      void recorder.pause().catch(reportError);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        pause();
        return;
      }
      if (
        session.condition.inputMode !== 'keyboard' ||
        ![
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(event.code) ||
        (event.target instanceof HTMLElement && /INPUT|SELECT|BUTTON/.test(event.target.tagName))
      )
        return;
      event.preventDefault();
      e.keys.add(event.code);
    };
    const keyUp = (event: KeyboardEvent) => e.keys.delete(event.code);
    const mouse = (event: MouseEvent) => {
      if (
        !movement.paused &&
        document.pointerLockElement === canvas.current &&
        session.condition.inputMode === 'keyboard'
      ) {
        e.yaw += event.movementX * 0.002;
        e.pitch = Math.max(-1.45, Math.min(1.45, e.pitch - event.movementY * 0.002));
      }
    };
    const lockChanged = () => {
      if (!document.pointerLockElement && !movement.paused) pause();
    };
    const detach = attachSessionLifecycle(recorder, pauseMovement, reportError);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('mousemove', mouse);
    document.addEventListener('pointerlockchange', lockChanged);
    const timer = setInterval(() => {
      if (mounted) {
        const s = recorder.status();
        setClock({ elapsedMs: s.elapsedMs, distanceM: s.distanceM });
      }
    }, 250);
    return () => {
      mounted = false;
      pauseMovement();
      detach();
      clearInterval(timer);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('mousemove', mouse);
      document.removeEventListener('pointerlockchange', lockChanged);
      if (document.pointerLockElement === canvas.current) void document.exitPointerLock();
      void recorder.pause().catch(() => {});
      scene.dispose();
      engine.current = null;
    };
  }, [world, session]);
  const action = async (run: (e: NonNullable<typeof engine.current>) => Promise<void>) => {
    if (busy || !engine.current) return;
    setBusy(true);
    setError('');
    try {
      await run(engine.current);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const terminal = status?.state === 'finished' || status?.state === 'stopped';
  const running = status?.state === 'running';
  const touch = session.condition.inputMode === 'touch';
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  return (
    <div className="walk" aria-label="Слепое прохождение">
      <canvas
        ref={canvas}
        tabIndex={0}
        className="walk-canvas"
        aria-label="Вид от первого лица"
        onClick={() => {
          if (running && !touch)
            void canvas.current?.requestPointerLock()?.catch((e) => setError(message(e)));
        }}
        onPointerDown={(event) => {
          if (touch && running) {
            event.currentTarget.setPointerCapture(event.pointerId);
            touchOrigin.current = { x: event.clientX, y: event.clientY };
          }
        }}
        onPointerMove={(event) => {
          const p = touchOrigin.current,
            e = engine.current;
          if (!p || !e || !running) return;
          e.yaw += (event.clientX - p.x) * 0.005;
          e.pitch = Math.max(-1.45, Math.min(1.45, e.pitch - (event.clientY - p.y) * 0.005));
          touchOrigin.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => {
          touchOrigin.current = null;
        }}
        onPointerCancel={() => {
          touchOrigin.current = null;
        }}
      />
      <header className="walk-hud">
        <span>{stateLabels[status?.state ?? session.state]}</span>
        <span role="status">
          {status?.save === 'error'
            ? 'Ошибка записи'
            : status?.save === 'saving'
              ? 'Сохраняется…'
              : 'Сохранено'}
        </span>
        <button
          disabled={busy}
          onClick={() =>
            void action(async (e) => {
              e.movement.setPaused(true);
              await e.recorder.pause();
            })
          }
        >
          Пауза
        </button>
      </header>
      {running && touch && (
        <div className="touch-move" aria-label="Движение">
          {[
            ['KeyW', 'Вперёд'],
            ['KeyA', 'Влево'],
            ['KeyS', 'Назад'],
            ['KeyD', 'Вправо'],
          ].map(([key, label]) => (
            <button
              key={key}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                engine.current?.keys.add(key!);
              }}
              onPointerUp={() => engine.current?.keys.delete(key!)}
              onPointerCancel={() => engine.current?.keys.delete(key!)}
              onLostPointerCapture={() => engine.current?.keys.delete(key!)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {(!running || error || lost) && (
        <section
          className="walk-panel"
          aria-label={terminal ? 'Результат прохождения' : 'Управление прохождением'}
        >
          <p className="eyebrow">ПОПЫТКА {session.sessionId.slice(0, 8)}</p>
          <h1>
            {terminal
              ? stateLabels[status!.state]
              : lost
                ? 'Сцена приостановлена'
                : stateLabels[status?.state ?? session.state]}
          </h1>
          <p>
            {(clock.elapsedMs / 1000).toFixed(1)} с · {clock.distanceM.toFixed(2)} м
          </p>
          <p>
            {session.condition.previewed
              ? 'Карта ранее просмотрена на этом устройстве.'
              : 'Попытка без предварительного просмотра.'}
          </p>
          {session.state === 'interrupted' && !running && !terminal && (
            <p>
              Восстановлена последняя подтверждённая запись. Интервал после неё мог не сохраниться.
            </p>
          )}
          {!terminal && (
            <p>
              {touch
                ? 'Удерживайте кнопки для движения. Проведите по сцене для поворота.'
                : 'WASD — движение, стрелки — поворот. Нажмите на сцену для управления мышью. Esc — пауза.'}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {status?.error && <p role="alert">{status.error}</p>}
          {status?.save === 'error' && (
            <button disabled={busy} onClick={() => void action((e) => e.recorder.retry())}>
              Повторить запись
            </button>
          )}
          {lost && (
            <button onClick={() => engine.current?.scene.restore()}>Восстановить сцену</button>
          )}
          {!terminal && !lost && (
            <button
              className="primary"
              disabled={busy || !status || status.save !== 'saved' || !!status.error}
              onClick={() =>
                void action(async (e) => {
                  await e.recorder.start();
                  e.keys.clear();
                  e.movement.setPaused(e.recorder.status().state !== 'running');
                  canvas.current?.focus();
                })
              }
            >
              {session.state === 'prepared' && !status?.elapsedMs ? 'Начать' : 'Продолжить'}
            </button>
          )}
          {!terminal && (
            <button disabled={busy} onClick={() => setStopConfirm(true)}>
              Завершить попытку
            </button>
          )}
          {stopConfirm && !terminal && (
            <div>
              <p>Остановить попытку и сохранить результат?</p>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async (e) => {
                    e.movement.setPaused(true);
                    await e.recorder.finish('stopped');
                    setStopConfirm(false);
                  })
                }
              >
                Остановить и сохранить
              </button>
              <button onClick={() => setStopConfirm(false)}>Отмена</button>
            </div>
          )}
          <button
            disabled={busy || status?.save === 'saving' || status?.save === 'error'}
            onClick={() =>
              void action(async (e) => {
                e.movement.setPaused(true);
                await e.recorder.pause();
                onClose();
              })
            }
          >
            В библиотеку
          </button>
        </section>
      )}
    </div>
  );
}
