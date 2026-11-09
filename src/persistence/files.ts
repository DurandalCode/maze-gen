import {isAndroidApp,downloadJson} from './platform';
import { isTauri } from '@tauri-apps/api/core';
import { deserialize, serialize } from './maze-json';
import type { Maze } from '../core/maze';

export async function saveMaze(maze: Maze): Promise<boolean> {
  const text = serialize(maze);
  if(isAndroidApp()){downloadJson('maze-lab.json',text);return true;}
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: 'maze-lab.json', filters: [{ name: 'Maze Lab', extensions: ['json'] }] });
    if (!path) return false;
    await writeTextFile(path, text);
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'maze-lab.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}

export async function loadMaze(): Promise<Maze | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: 'Maze Lab', extensions: ['json'] }] });
    return path ? deserialize(await readTextFile(path)) : null;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      if (file.size > 5_000_000) { reject(new Error('Файл больше 5 МБ.')); return; }
      file.text().then(text => resolve(deserialize(text))).catch(reject);
    }, { once: true });
    input.click();
  });
}
