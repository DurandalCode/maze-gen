import {isOfflineLibrary} from '../persistence/platform';
import {exportLibrary,importLibrary} from '../persistence/library-export';
import {WalkComparison} from './walk-comparison';
import { useEffect, useState } from 'react';
import { getLibraryMaze, getLibraryWalk, listLibraryMazes, listLibraryWalks } from '../persistence/library';
import { restoreRecorder } from '../persistence/walk-json';
import type { Maze } from '../core/maze';
import type { WalkResult } from './views';
export function LibraryPanel({ open, revision, onClose, onMaze, onWalk, onPlay }: {
  open: boolean;
  revision: number;
  onClose: () => void;
  onMaze: (maze: Maze) => void;
  onPlay: (maze:Maze)=>void;
  onWalk: (maze: Maze, result: WalkResult) => void;
}) {
  const [mazes, setMazes] = useState<Awaited<ReturnType<typeof listLibraryMazes>>['mazes']>([]);
  const [walks, setWalks] = useState<Awaited<ReturnType<typeof listLibraryWalks>>['walks']>([]);
  const [notice,setNotice]=useState('');
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!open)
      return;
    let active = true;
    setBusy(true);
    setError('');
    Promise.all([listLibraryMazes(), listLibraryWalks()]).then(([a, b]) => { if (active) {
      setMazes(a.mazes);
      setWalks(b.walks);
    } }).catch(e => { if (active)
      setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (active)
      setBusy(false); });
    return () => { active = false; };
  }, [open, revision, refresh]);
  const load = async (kind: 'maze' | 'walk' | 'play', id: string) => {
    setBusy(true);
    setError('');
    try {
      if (kind === 'maze'||kind==='play'){
        const maze=(await getLibraryMaze(id)).maze;
        if(kind==='play')onPlay(maze);else onMaze(maze);
      }
      else {
        const row = await getLibraryWalk(id);
        onWalk(row.walk.maze, { id: row.id, finished: row.walk.finished, recorder: restoreRecorder(row.walk.recording) });
      }
      onClose();
    }
    catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    finally {
      setBusy(false);
    }
  };
  const transfer=async(kind:'export'|'import')=>{
    setBusy(true);setError('');setNotice('');
    try{const result=kind==='export'?await exportLibrary():await importLibrary();if(result){setNotice(kind==='export'?`Экспорт: ${result.walks} прохождений и ${result.mazes} карт. Отправьте JSON файлом через Telegram.`:`Импорт: ${result.walks} прохождений и ${result.mazes} карт.`);if(kind==='import')setRefresh(n=>n+1);}}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const firstAttempts = new Map<string, string>();
  for (const row of [...walks].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    if (!firstAttempts.has(row.topologyId))
      firstAttempts.set(row.topologyId, row.id);
  const comparable = walks.filter(row => row.finished && row.assessment.exploration && firstAttempts.get(row.topologyId) === row.id);
  if (!open)
    return null;
  return <section className="library-panel" aria-label="Общая библиотека">
  <div className="library-heading"><h3>{isOfflineLibrary()?'Библиотека устройства':'Общая библиотека'}</h3><div><button onClick={() => setRefresh(n => n + 1)} disabled={busy}>Обновить библиотеку</button><button aria-label="Закрыть библиотеку" onClick={onClose}>×</button></div></div>
  <p>{isOfflineLibrary()?'Карты и записи хранятся на этом устройстве. Интернет для прохождения не нужен.':'Лабиринты и прохождения доступны во всех браузерах, подключённых к этому серверу.'}</p>
  <div className="library-transfer"><button disabled={busy} onClick={()=>void transfer('export')}>Экспортировать записи</button><button disabled={busy} onClick={()=>void transfer('import')}>Импортировать записи</button></div>
  <p>Экспорт включает траектории и настройки карт. Сохраните файл перед удалением приложения или очисткой данных.</p>
  {notice&&<p role="status">{notice}</p>}
  {busy && <p role="status">Загрузка…</p>}{error && <p role="alert" className="shape-error">{error}</p>}
  <h4>Лабиринты · {mazes.length}</h4>
  {!busy && !mazes.length && <p>Пока нет сохранённых лабиринтов. Нажмите «В библиотеку».</p>}
  <ul>{mazes.map(row => <li key={row.id}><div><strong>{row.title}{row.status==='rejected'?' · отклонён':''}</strong><span>{row.generationType==='living'?'Живой':'Классический'} · {row.modules === null ? 'Сетка' : `${row.modules} модулей`} · {new Date(row.updatedAt).toLocaleString('ru-RU')}</span>{row.rejectionReason&&<span>{row.rejectionReason}</span>}</div><button disabled={busy} aria-label={`Пройти вслепую ${row.title}`} onClick={()=>void load('play',row.id)}>{walks.some(w=>w.mazeId===row.id&&w.finished)?'Пройти снова':'Пройти вслепую'}</button><button disabled={busy} aria-label={`Открыть лабиринт ${row.title}`} onClick={() => void load('maze', row.id)}>Открыть</button></li>)}</ul>
  <WalkComparison walks={comparable} mazes={mazes}/>
  <h4>Прохождения · {walks.length}</h4>
  {!busy && !walks.length && <p>После начала движения запись сохраняется каждые 10 секунд и при завершении.</p>}
  <ul>{walks.map(row => <li key={row.id}><div><strong>{row.columns} × {row.rows} · {row.finished ? 'Финиш найден' : row.status === 'in-progress' ? 'Промежуточная запись' : 'Остановлено'}</strong><span>{row.distance.toFixed(1)} м · {row.elapsed.toFixed(0)} с · {new Date(row.updatedAt).toLocaleString('ru-RU')}</span></div><button disabled={busy} aria-label={`Открыть прохождение ${row.id}`} onClick={() => void load('walk', row.id)}>Карта и маршрут</button></li>)}</ul>
  </section>;
}
