import type { FreeDraft } from './model';
export interface EditorHistory { past: FreeDraft[]; present: FreeDraft; future: FreeDraft[] }
export type EditorAction = { type: 'change'; draft: FreeDraft } | { type: 'undo' } | { type: 'redo' };
export const history = (draft: FreeDraft): EditorHistory => ({ past: [], present: structuredClone(draft), future: [] });
export function editorReducer(state: EditorHistory, action: EditorAction): EditorHistory {
  if (action.type === 'change') return { past: [...state.past.slice(-99), state.present], present: structuredClone(action.draft), future: [] };
  if (action.type === 'undo') {
    const present = state.past.at(-1);
    return present ? { past: state.past.slice(0, -1), present, future: [state.present, ...state.future] } : state;
  }
  const present = state.future[0];
  return present ? { past: [...state.past, state.present], present, future: state.future.slice(1) } : state;
}
