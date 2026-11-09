import { routingSize, type Maze, type Portal } from '../core/maze';
import { mazePortals, samePortal, withPortals } from '../core/portals';

export type PortalEdit = 'add' | number | null;

export function PortalControls({ maze, edit, onEdit, onChange }: {
  maze: Maze; edit: PortalEdit; onEdit: (edit: PortalEdit) => void; onChange: (maze: Maze) => void;
}) {
  const portals = mazePortals(maze), size = routingSize(maze);
  const sideNames = { north: 'Север', east: 'Восток', south: 'Юг', west: 'Запад' };
  const select = (key: 'entrance' | 'exit', index: number) => {
    const selected = portals[index]!, other = key === 'entrance' ? 'exit' : 'entrance';
    onChange({ ...maze, portals: [...portals], [key]: selected,
      [other]: samePortal(selected, maze[other]) ? maze[key] : maze[other] });
  };
  const label = (p: Portal, i: number) => {
    const position = p.side === 'north' || p.side === 'south' ? p.cell%size.columns : Math.floor(p.cell/size.columns);
    return `${i+1} · ${sideNames[p.side]} · ${position+1}`;
  };
  return <section className="portal-controls" aria-label="Входы и выходы">
    <div className="section-label"><span>ВХОДЫ И ВЫХОДЫ</span><span>{portals.length}</span></div>
    <p>Все проёмы связаны общей сетью. Выберите пару для карты и прохождения.</p>
    <div className="field-pair">
      {(['entrance', 'exit'] as const).map(key => <label className="field" key={key}><span>{key === 'entrance' ? 'Старт' : 'Финиш'}</span>
        <select aria-label={key === 'entrance' ? 'Старт' : 'Финиш'} value={portals.findIndex(p => samePortal(p, maze[key]))}
          onChange={e => select(key, Number(e.target.value))}>
          {portals.map((p, i) => <option key={i} value={i}>{label(p, i)}</option>)}
        </select></label>)}
    </div>
    <button type="button" className="portal-add" onClick={() => onChange({ ...maze,
      portals: [...portals], entrance: maze.exit, exit: maze.entrance })}>⇄ Поменять местами</button>
    <ol>{portals.map((p, i) => <li key={`${p.cell}:${p.side}`}>
      <span>{label(p, i)}</span>
      <button type="button" aria-label={`Переместить проём ${i+1}`} aria-pressed={edit === i} onClick={() => onEdit(edit === i ? null : i)}>↗</button>
      <button type="button" aria-label={`Удалить проём ${i+1}`} disabled={portals.length <= 2}
        onClick={() => { onChange(withPortals(maze, portals.filter((_, index) => index !== i))); onEdit(null); }}>×</button>
    </li>)}</ol>
    <button type="button" className="portal-add" aria-pressed={edit === 'add'} onClick={() => onEdit(edit === 'add' ? null : 'add')}>+ Добавить вход-выход</button>
    {edit !== null && <div className="portal-edit-notice" role="status">
      {edit === 'add' ? 'Нажмите на внешнюю границу карты, чтобы добавить проём.' : `Нажмите на внешнюю границу: новое место проёма ${edit+1}.`}
      <button type="button" onClick={() => onEdit(null)}>Отмена</button>
    </div>}
  </section>;
}
