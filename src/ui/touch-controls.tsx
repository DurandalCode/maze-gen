import { useEffect, useRef } from 'react';
import { neutralStick, stickVector, type StickVector } from './touch-input';

export function TouchControls({ onMove, onLook, onError }: {
  onMove: (vector: StickVector) => void; onLook: (vector: StickVector) => void; onError: (message: string) => void;
}) {
  const move = useRef<HTMLDivElement>(null), look = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    const managers: Array<{ destroy(): void }> = [];
    const release = () => { onMove(neutralStick()); onLook(neutralStick()); };
    // Independent static zones each track one finger; the factory tracks both concurrently.
    void import('nipplejs').then(({ create }) => {
      if (disposed || !move.current || !look.current) return;
      for (const [zone, update] of [[move.current, onMove], [look.current, onLook]] as const) {
        const manager = create({ zone, mode: 'static', position: { left: '50%', top: '50%' },
          size: 108, color: '#d1ee86', restOpacity: 0.65, threshold: 0, fadeTime: 80 });
        manager.on('move', event => update(stickVector(event.data.vector)));
        manager.on('end', () => update(neutralStick()));
        managers.push(manager);
      }
    }).catch(() => { if (!disposed) onError('Не удалось загрузить сенсорное управление. Вернитесь к карте и повторите.'); });
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    // Cancel affects both sticks: no held direction survives an OS interruption.
    window.addEventListener('pointercancel', release);
    window.addEventListener('touchcancel', release);
    return () => {
      disposed = true; release(); managers.forEach(manager => manager.destroy());
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('touchcancel', release);
    };
  }, [onMove, onLook, onError]);
  return <div className="touch-controls" aria-label="Сенсорное управление двумя джойстиками">
    <div className="touch-stick touch-stick-move" ref={move} aria-label="Левый джойстик: движение"><span>ХОДЬБА / БЕГ</span></div>
    <div className="touch-stick touch-stick-look" ref={look} aria-label="Правый джойстик: обзор"><span>ОБЗОР</span></div>
  </div>;
}
