import type { SessionState } from '../session/types';
export const stateLabels: Record<SessionState, string> = {
  prepared: 'Готово к старту',
  running: 'Прохождение',
  paused: 'Пауза',
  interrupted: 'Прервано',
  finished: 'Финиш',
  stopped: 'Остановлено',
};
