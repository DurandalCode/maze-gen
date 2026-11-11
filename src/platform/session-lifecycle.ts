import type { Recorder } from '../session/recorder';
/** Movement pauses synchronously; periodic commits remain the durability guarantee. */
export function attachSessionLifecycle(
  recorder: Recorder,
  pauseMovement: () => void,
  onError: (error: unknown) => void,
): () => void {
  const pause = () => {
    pauseMovement();
    void recorder.pause().catch(onError);
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') pause();
  };
  window.addEventListener('blur', pause);
  window.addEventListener('pagehide', pause);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    window.removeEventListener('blur', pause);
    window.removeEventListener('pagehide', pause);
    document.removeEventListener('visibilitychange', visibility);
  };
}
