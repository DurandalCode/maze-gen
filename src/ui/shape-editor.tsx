import { useRef, useState, type PointerEvent } from 'react';
import { emptyMaze, validateParameters, type Parameters } from '../core/maze';
import { shapeMask, type ShapeRectangle } from '../core/domain';
export type ShapeTool = 'select' | 'add' | 'subtract';
interface ControlsProps {
  value: Parameters;
  onChange: (value: Parameters) => void;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  selected: number | null;
  onSelect: (index: number | null) => void;
  tool: ShapeTool;
  onTool: (tool: ShapeTool) => void;
}
export function shapeStatus(p: Parameters): {
  error: string;
  area: number;
  count: number;
} {
  let area = 0, count = 0;
  try {
    validateParameters({ ...p, shape: undefined });
    const mask = shapeMask(p);
    count = mask.reduce((sum, n) => sum + n, 0);
    if (p.moduleSize === undefined)
      area = count * p.corridorWidth ** 2;
    else {
      const m = p.moduleSize, g = p.corridorWidth;
      area = count * m * m;
      for (let z = 0; z < p.rows; z++)
        for (let x = 0; x < p.columns; x++)
          if (mask[z * p.columns + x]) {
            const right = x + 1 < p.columns && mask[z * p.columns + x + 1], down = z + 1 < p.rows && mask[(z + 1) * p.columns + x];
            if (right)
              area += m * g;
            if (down)
              area += m * g;
            if (right && down && mask[(z + 1) * p.columns + x + 1])
              area += g * g;
          }
    }
    emptyMaze(p);
    return { error: '', area, count };
  }
  catch (e) {
    return { error: e instanceof Error ? e.message : String(e), area, count };
  }
}
export function ShapeControls({ value: p, onChange, editing, onEditing, selected, onSelect, tool, onTool }: ControlsProps) {
  const shape = p.shape, r = selected === null ? undefined : shape?.rectangles[selected], status = shapeStatus(p);
  const patch = (changes: Partial<ShapeRectangle>) => {
    if (!shape || selected === null)
      return;
    onChange({ ...p, shape: { ...shape, rectangles: shape.rectangles.map((v, i) => i === selected ? { ...v, ...changes } : v) } });
  };
  return <section className="shape-controls" aria-label="Форма лабиринта">
  <div className="section-label"><span>ФОРМА ЛАБИРИНТА</span><span>▧</span></div>
  <label className="field"><span>Форма</span><select aria-label="Форма" value={shape ? 'compound' : 'rectangle'} onChange={e => {
      if (e.target.value === 'compound') {
        onChange({ ...p, shape: { kind: 'grid-rectangles', rectangles: [{ x: 0, z: 0, width: p.columns, height: p.rows, operation: 'add' }] } });
        onSelect(0);
        onEditing(true);
      }
      else {
        const { shape: _, ...rest } = p;
        onChange(rest);
        onEditing(false);
        onSelect(null);
      }
    }}><option value="rectangle">Прямоугольник</option><option value="compound">Составная форма</option></select></label>
  {shape && <>
    <button type="button" className="shape-edit-toggle" onClick={() => onEditing(!editing)}>{editing ? 'Закрыть редактор формы' : 'Редактировать форму'}</button>
    {editing && <>
    <div className="shape-tools" aria-label="Инструменты формы">{(['select', 'add', 'subtract'] as const).map(t => <button key={t} type="button" aria-pressed={tool === t} onClick={() => onTool(t)}>{t === 'select' ? 'Выбрать' : t === 'add' ? 'Добавить' : 'Вырезать'}</button>)}</div>
    <p className="field-note">Тяните по сетке для рисования. Выбранный прямоугольник можно перемещать и менять за угол. X и Z отсчитываются от нуля.</p>
    <label className="field"><span>Прямоугольники</span><select aria-label="Прямоугольники" value={selected ?? ''} onChange={e => { onSelect(e.target.value === '' ? null : Number(e.target.value)); onTool('select'); }}>
      <option value="">Выберите прямоугольник</option>{shape.rectangles.map((v, i) => <option key={i} value={i}>{i + 1}. {v.operation === 'add' ? 'Добавить' : 'Вырезать'} · {v.width} × {v.height}</option>)}
    </select></label>
    {r && <div className="rectangle-fields">
      <div className="field-pair">{(['x', 'z', 'width', 'height'] as const).map(key => <label className="field" key={key}><span>{{ x: 'X', z: 'Z', width: 'Ширина', height: 'Высота' }[key]}</span><input aria-label={`Прямоугольник: ${key}`} type="number" step="1" min={key === 'x' || key === 'z' ? 0 : 1} value={Number.isNaN(r[key]) ? '' : r[key]} onChange={e => patch({ [key]: e.target.valueAsNumber })}/></label>)}</div>
      <label className="field"><span>Операция</span><select aria-label="Операция прямоугольника" value={r.operation} onChange={e => patch({ operation: e.target.value as ShapeRectangle['operation'] })}><option value="add">Добавить область</option><option value="subtract">Вырезать область</option></select></label>
      <button type="button" onClick={() => { onChange({ ...p, shape: { ...shape, rectangles: shape.rectangles.filter((_, i) => i !== selected) } }); onSelect(null); }}>Удалить прямоугольник</button>
    </div>}
    </>}
    <p className="field-note" role="status">{status.count} {p.moduleSize === undefined ? 'клеток' : 'модулей'} · {status.area.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²</p>
    {status.error && <p className="shape-error" role="alert">{status.error}</p>}
  </>}
  </section>;
}
interface EditorProps {
  value: Parameters;
  onChange: (value: Parameters) => void;
  selected: number | null;
  onSelect: (index: number | null) => void;
  tool: ShapeTool;
}
interface Gesture {
  start: {
    x: number;
    z: number;
  };
  current: {
    x: number;
    z: number;
  };
  type: ShapeTool | 'move' | 'resize' | 'pan';
  original?: ShapeRectangle;
  index?: number;
  client: {
    x: number;
    y: number;
  };
  shift: {
    x: number;
    z: number;
  };
}
export function ShapeEditor({ value: p, onChange, selected, onSelect, tool }: EditorProps) {
  const svg = useRef<SVGSVGElement>(null), [gesture, setGesture] = useState<Gesture | null>(null);
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, z: 0 });
  if (![p.columns, p.rows].every(n => Number.isInteger(n) && n >= 1 && n <= 100))
    return <div className="shape-editor shape-error" role="alert">Задайте размеры рабочей сетки от 1 до 100.</div>;
  const shape = p.shape!, padding = Math.max(p.columns, p.rows) * 0.08 + 0.5;
  const baseW = p.columns + 2 * padding, baseH = p.rows + 2 * padding;
  const view = { x: -padding + pan.x, z: -padding + pan.z, w: baseW / zoom, h: baseH / zoom };
  const point = (e: PointerEvent<SVGSVGElement>) => {
    const matrix = svg.current!.getScreenCTM()!;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: pt.x, z: pt.y };
  };
  const bound = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const candidate = (g: Gesture): ShapeRectangle | null => {
    if (g.type === 'pan' || g.type === 'select')
      return null;
    const dx = Math.round(g.current.x - g.start.x), dz = Math.round(g.current.z - g.start.z);
    if (g.original) {
      const r = g.original;
      if (g.type === 'move')
        return { ...r, x: bound(r.x + dx, p.columns - r.width), z: bound(r.z + dz, p.rows - r.height) };
      return { ...r, width: Math.max(1, Math.min(p.columns - r.x, r.width + dx)), height: Math.max(1, Math.min(p.rows - r.z, r.height + dz)) };
    }
    const ax = bound(Math.floor(g.start.x), p.columns - 1), az = bound(Math.floor(g.start.z), p.rows - 1);
    const bx = bound(Math.floor(g.current.x), p.columns - 1), bz = bound(Math.floor(g.current.z), p.rows - 1);
    return { x: Math.min(ax, bx), z: Math.min(az, bz), width: Math.abs(bx - ax) + 1, height: Math.abs(bz - az) + 1, operation: g.type === 'subtract' ? 'subtract' : 'add' };
  };
  const preview = gesture ? candidate(gesture) : null;
  const rectangles = shape.rectangles.map((r, i) => preview && gesture?.index === i ? preview : r);
  if (preview && gesture?.index === undefined)
    rectangles.push(preview);
  let mask: Uint8Array = new Uint8Array(p.columns * p.rows);
  try {
    mask = shapeMask({ ...p, shape: { ...shape, rectangles } });
  }
  catch { /* Invalid numeric draft is explained in controls. */ }
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1)
      return;
    const q0 = point(e);
    if (e.button === 0 && tool !== 'select' && (q0.x < 0 || q0.z < 0 || q0.x >= p.columns || q0.z >= p.rows))
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const q = point(e), base = { start: q, current: q, client: { x: e.clientX, y: e.clientY }, shift: { ...pan } };
    if (e.button === 1) {
      setGesture({ ...base, type: 'pan' });
      return;
    }
    if (tool !== 'select') {
      setGesture({ ...base, type: tool });
      return;
    }
    const index = Number((e.target as SVGElement).getAttribute('data-index'));
    if (!(e.target as SVGElement).hasAttribute('data-index')) {
      onSelect(null);
      return;
    }
    const original = shape.rectangles[index]!;
    onSelect(index);
    setGesture({ ...base, type: (e.target as SVGElement).getAttribute('data-handle') === 'resize' ? 'resize' : 'move', original, index });
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!gesture)
      return;
    if (gesture.type === 'pan') {
      const matrix = svg.current!.getScreenCTM()!;
      setPan({ x: gesture.shift.x - (e.clientX - gesture.client.x) / matrix.a, z: gesture.shift.z - (e.clientY - gesture.client.y) / matrix.d });
      return;
    }
    setGesture({ ...gesture, current: point(e) });
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    if (!gesture)
      return;
    const r = candidate({ ...gesture, current: point(e) });
    if (r) {
      const next = [...shape.rectangles];
      if (gesture.index !== undefined)
        next[gesture.index] = r;
      else {
        next.push(r);
        onSelect(next.length - 1);
      }
      onChange({ ...p, shape: { ...shape, rectangles: next } });
    }
    setGesture(null);
  };
  const handle = Math.max(p.columns, p.rows) * 0.025 / zoom;
  return <div className="shape-editor">
  <div className="shape-editor-heading"><strong>Черновик формы</strong><span>Изменения применятся при генерации</span></div>
  <svg ref={svg} role="img" aria-label="Редактор формы лабиринта" viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setGesture(null)} onWheel={e => { setZoom(z => Math.max(0.5, Math.min(8, z * Math.exp(-e.deltaY * 0.001)))); }} onAuxClick={e => e.preventDefault()}>
    <rect x="0" y="0" width={p.columns} height={p.rows} fill="#151c17"/>
    {Array.from(mask, (active, i) => active ? <rect key={i} x={i % p.columns} y={Math.floor(i / p.columns)} width="1" height="1" fill="#78945d"/> : null)}
    <g stroke="#56654d" strokeWidth="0.015" pointerEvents="none">{Array.from({ length: p.columns + 1 }, (_, i) => <path key={`x${i}`} d={`M${i} 0V${p.rows}`}/>)}{Array.from({ length: p.rows + 1 }, (_, i) => <path key={`z${i}`} d={`M0 ${i}H${p.columns}`}/>)}</g>
    {rectangles.map((r, i) => [r.x, r.z, r.width, r.height].every(Number.isFinite) ? <rect key={i} data-index={i} x={r.x} y={r.z} width={r.width} height={r.height} fill="transparent" stroke={r.operation === 'subtract' ? '#eea181' : '#d1ee86'} strokeWidth={selected === i ? '0.065' : '0.025'} strokeDasharray={r.operation === 'subtract' ? '0.16 0.08' : undefined} style={{ pointerEvents: tool === 'select' ? 'all' : 'none', cursor: 'move' }}/> : null)}
    {selected !== null && rectangles[selected] && (() => { const r = rectangles[selected]!; return [r.x, r.z, r.width, r.height].every(Number.isFinite) ? <rect data-index={selected} data-handle="resize" x={r.x + r.width - handle} y={r.z + r.height - handle} width={handle * 2} height={handle * 2} fill="#d1ee86" style={{ cursor: 'nwse-resize', pointerEvents: tool === 'select' ? 'all' : 'none' }}/> : null; })()}
  </svg>
  <div className="shape-editor-footer"><span>{p.columns} × {p.rows} · {p.moduleSize === undefined ? 'клетки' : 'модули'} · X → Z ↓</span><button type="button" onClick={() => { setZoom(1); setPan({ x: 0, z: 0 }); }}>Вписать форму</button></div>
  <p className="field-note">Колесо — масштаб · средняя кнопка — перемещение · зелёное — итоговая область</p>
  </div>;
}
