import { useEffect, useMemo, useState } from 'react';
import type {
  BoundaryLoop,
  Document,
  Environment,
  FreeWall,
  Instance,
  Opening,
  Point,
  Segment,
} from '../domain';
import { CommandStore, removal } from '../editor/commands';
import type { Change, EditorState } from '../editor/commands';
import { sampleSegment } from '../geometry/kernel/contour';
import { bounds } from '../geometry/predicates';
export function NumberField({
  label,
  value,
  change,
  min,
  max,
  step = 0.1,
}: {
  label: string;
  value: number;
  change: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label>
      {label}
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (!text.trim() || !Number.isFinite(n)) {
            setText(String(value));
            return;
          }
          if (n !== value) change(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setText(String(value));
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
export function wallCenter(segment: Segment): Point {
  return segment.kind === 'arc'
    ? segment.center
    : { x: (segment.from.x + segment.to.x) / 2, z: (segment.from.z + segment.to.z) / 2 };
}
export function rotateWall(wall: FreeWall, delta: number): FreeWall {
  const segment = wall.centerline;
  if (segment.kind === 'arc')
    return { ...wall, centerline: { ...segment, startAngle: segment.startAngle + delta } };
  const center = wallCenter(segment),
    c = Math.cos(delta),
    s = Math.sin(delta),
    rotate = (p: Point) => ({
      x: center.x + (p.x - center.x) * c - (p.z - center.z) * s,
      z: center.z + (p.x - center.x) * s + (p.z - center.z) * c,
    });
  return {
    ...wall,
    centerline: { ...segment, from: rotate(segment.from), to: rotate(segment.to) },
  };
}
export function EditorProperties({
  store,
  state,
  panel,
  error,
}: {
  store: CommandStore;
  state: EditorState;
  panel: 'selection' | 'site' | 'environment';
  error: (error: unknown) => void;
}) {
  const doc = state.document,
    selection = state.selection;
  const execute = (label: string, changes: Change[]) => {
    try {
      store.execute(label, changes);
    } catch (e) {
      error(e);
    }
  };
  const instance =
    selection?.field === 'instances' ? doc.instances.find((i) => i.id === selection.id) : undefined;
  const opening =
    selection?.field === 'openings' ? doc.openings.find((i) => i.id === selection.id) : undefined;
  const wall =
    selection?.field === 'freeWalls' ? doc.freeWalls.find((i) => i.id === selection.id) : undefined;
  const connection =
    selection?.field === 'connections'
      ? doc.connections.find((i) => i.id === selection.id)
      : undefined;
  const updateInstance = (id: string, change: (current: Instance) => Instance) => {
    const value = store.getSnapshot().document.instances.find((i) => i.id === id);
    if (value) execute('Свойства модуля', [{ field: 'instances', id, value: change(value) }]);
  };
  const updateOpening = (id: string, change: (current: Opening) => Opening) => {
    const value = store.getSnapshot().document.openings.find((i) => i.id === id);
    if (value) execute('Свойства проёма', [{ field: 'openings', id, value: change(value) }]);
  };
  const updateWall = (id: string, change: (current: FreeWall) => FreeWall) => {
    const value = store.getSnapshot().document.freeWalls.find((i) => i.id === id);
    if (value) execute('Свойства стены', [{ field: 'freeWalls', id, value: change(value) }]);
  };
  if (panel === 'site') return <SiteProperties document={doc} execute={execute} error={error} />;
  if (panel === 'environment') return <EnvironmentProperties document={doc} execute={execute} />;
  return (
    <div className="property-fields">
      {!selection && <p>Выберите модуль, проём, соединение или отдельную стену на плане.</p>}
      {instance && (
        <>
          <h3>Модуль · {instance.id.slice(0, 8)}</h3>
          <NumberField
            label="Положение X, м"
            value={instance.position.x}
            change={(x) =>
              updateInstance(instance.id, (i) => ({ ...i, position: { ...i.position, x } }))
            }
          />
          <NumberField
            label="Положение Z, м"
            value={instance.position.z}
            change={(z) =>
              updateInstance(instance.id, (i) => ({ ...i, position: { ...i.position, z } }))
            }
          />
          <NumberField
            label="Поворот, °"
            value={(instance.rotationRad * 180) / Math.PI}
            step={1}
            change={(rotation) =>
              updateInstance(instance.id, (i) => ({
                ...i,
                rotationRad: (rotation * Math.PI) / 180,
              }))
            }
          />
          {doc.definitions
            .find((d) => d.contentHash === instance.definitionHash)!
            .parameters.map((p) => (
              <NumberField
                key={p.id}
                label={`Размер ${p.id}, м`}
                value={instance.parameterValues[p.id]!}
                min={p.min}
                max={p.max}
                change={(value) =>
                  updateInstance(instance.id, (i) => ({
                    ...i,
                    parameterValues: { ...i.parameterValues, [p.id]: value },
                  }))
                }
              />
            ))}
          <p>Перетаскивание — перенос. Shift + перетаскивание — поворот. R — поворот на 15°.</p>
        </>
      )}
      {opening &&
        (() => {
          const owner = doc.instances.find((i) => i.id === opening.instanceId)!,
            definition = doc.definitions.find((d) => d.contentHash === owner.definitionHash)!;
          return (
            <>
              <h3>Проём · {opening.id.slice(0, 8)}</h3>
              <label>
                Назначение
                <select
                  value={opening.role}
                  onChange={(e) =>
                    updateOpening(opening.id, (o) => ({
                      ...o,
                      role: e.target.value as Opening['role'],
                    }))
                  }
                >
                  <option value="ordinary">Внутренний</option>
                  <option value="entrance">Вход</option>
                  <option value="exit">Выход</option>
                </select>
              </label>
              <label>
                Грань
                <select
                  value={opening.regionId}
                  onChange={(e) => {
                    const region = definition.openingRegions.find((r) => r.id === e.target.value)!;
                    updateOpening(opening.id, (o) => ({
                      ...o,
                      regionId: region.id,
                      boundarySegmentId: region.segmentId,
                      widthM: Math.max(region.minWidthM, Math.min(region.maxWidthM, o.widthM)),
                    }));
                  }}
                >
                  {definition.openingRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.segmentId}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label="Положение на грани, %"
                value={opening.uCenter * 100}
                min={0}
                max={100}
                step={1}
                change={(u) => updateOpening(opening.id, (o) => ({ ...o, uCenter: u / 100 }))}
              />
              <NumberField
                label="Ширина проёма, м"
                value={opening.widthM}
                min={1}
                max={3}
                change={(widthM) => updateOpening(opening.id, (o) => ({ ...o, widthM }))}
              />
              <p>
                Проём перемещается вместе с модулем. Фактический просвет проверяется с учётом опор.
              </p>
            </>
          );
        })()}
      {wall &&
        (() => {
          const center = wallCenter(wall.centerline),
            segment = wall.centerline;
          const move = (axis: 'x' | 'z', value: number) =>
            updateWall(wall.id, (w) => {
              const c = wallCenter(w.centerline),
                delta = value - c[axis];
              return {
                ...w,
                centerline:
                  w.centerline.kind === 'arc'
                    ? { ...w.centerline, center: { ...w.centerline.center, [axis]: value } }
                    : {
                        ...w.centerline,
                        from: { ...w.centerline.from, [axis]: w.centerline.from[axis] + delta },
                        to: { ...w.centerline.to, [axis]: w.centerline.to[axis] + delta },
                      },
              };
            });
          return (
            <>
              <h3>Отдельная стена</h3>
              <NumberField label="Центр стены X, м" value={center.x} change={(x) => move('x', x)} />
              <NumberField label="Центр стены Z, м" value={center.z} change={(z) => move('z', z)} />
              {segment.kind === 'line' ? (
                <>
                  <NumberField
                    label="Длина стены, м"
                    min={0.1}
                    value={Math.hypot(segment.to.x - segment.from.x, segment.to.z - segment.from.z)}
                    change={(length) =>
                      updateWall(wall.id, (w) => {
                        if (w.centerline.kind !== 'line') return w;
                        const c = wallCenter(w.centerline),
                          angle = Math.atan2(
                            w.centerline.to.z - w.centerline.from.z,
                            w.centerline.to.x - w.centerline.from.x,
                          ),
                          dx = (Math.cos(angle) * length) / 2,
                          dz = (Math.sin(angle) * length) / 2;
                        return {
                          ...w,
                          centerline: {
                            ...w.centerline,
                            from: { x: c.x - dx, z: c.z - dz },
                            to: { x: c.x + dx, z: c.z + dz },
                          },
                        };
                      })
                    }
                  />
                  <NumberField
                    label="Угол стены, °"
                    value={
                      (Math.atan2(segment.to.z - segment.from.z, segment.to.x - segment.from.x) *
                        180) /
                      Math.PI
                    }
                    step={1}
                    change={(angle) =>
                      updateWall(wall.id, (w) =>
                        w.centerline.kind === 'line'
                          ? rotateWall(
                              w,
                              (angle * Math.PI) / 180 -
                                Math.atan2(
                                  w.centerline.to.z - w.centerline.from.z,
                                  w.centerline.to.x - w.centerline.from.x,
                                ),
                            )
                          : w,
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <NumberField
                    label="Радиус стены, м"
                    min={0.1}
                    value={segment.radius}
                    change={(radius) =>
                      updateWall(wall.id, (w) =>
                        w.centerline.kind === 'arc'
                          ? { ...w, centerline: { ...w.centerline, radius } }
                          : w,
                      )
                    }
                  />
                  <NumberField
                    label="Начальный угол, °"
                    value={(segment.startAngle * 180) / Math.PI}
                    step={1}
                    change={(angle) =>
                      updateWall(wall.id, (w) =>
                        w.centerline.kind === 'arc'
                          ? {
                              ...w,
                              centerline: { ...w.centerline, startAngle: (angle * Math.PI) / 180 },
                            }
                          : w,
                      )
                    }
                  />
                  <NumberField
                    label="Дуга, °"
                    value={(segment.sweep * 180) / Math.PI}
                    min={-360}
                    max={360}
                    step={1}
                    change={(angle) =>
                      updateWall(wall.id, (w) =>
                        w.centerline.kind === 'arc'
                          ? {
                              ...w,
                              centerline: { ...w.centerline, sweep: (angle * Math.PI) / 180 },
                            }
                          : w,
                      )
                    }
                  />
                </>
              )}
            </>
          );
        })()}
      {connection && <h3>Соединение · {connection.id.slice(0, 8)}</h3>}
      <ConnectionProperties
        document={doc}
        selected={connection?.id ?? null}
        selectedOpening={opening?.id ?? null}
        execute={execute}
      />
      {selection && (
        <button
          onClick={() =>
            execute('Удаление объекта', removal(store.getSnapshot().document, selection))
          }
        >
          Удалить{' '}
          {selection.field === 'instances'
            ? 'модуль и его проёмы'
            : selection.field === 'openings'
              ? 'проём и его связи'
              : selection.field === 'freeWalls'
                ? 'стену'
                : 'соединение'}
        </button>
      )}
    </div>
  );
}
function ConnectionProperties({
  document,
  selected,
  selectedOpening,
  execute,
}: {
  document: Document;
  selected: string | null;
  selectedOpening: string | null;
  execute: (label: string, changes: Change[]) => void;
}) {
  const current = document.connections.find((c) => c.id === selected);
  const used = new Set(
    document.connections.filter((c) => c.id !== selected).flatMap((c) => [c.openingA, c.openingB]),
  );
  const available = document.openings.filter((o) => o.role === 'ordinary' && !used.has(o.id));
  const [a, setA] = useState(current?.openingA ?? selectedOpening ?? ''),
    [b, setB] = useState(current?.openingB ?? '');
  useEffect(() => {
    setA(current?.openingA ?? selectedOpening ?? '');
    setB(current?.openingB ?? '');
  }, [selected, selectedOpening, current?.openingA, current?.openingB]);
  if (!available.length && !current) return null;
  return (
    <section className="connection-properties">
      <h3>{current ? 'Параметры соединения' : 'Соединить проёмы'}</h3>
      <label>
        Первый проём
        <select value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">Выберите…</option>
          {available.map((o) => (
            <option key={o.id} value={o.id}>
              {o.instanceId.slice(0, 8)} · {o.boundarySegmentId} · {o.id.slice(-6)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Второй проём
        <select value={b} onChange={(e) => setB(e.target.value)}>
          <option value="">Выберите…</option>
          {available
            .filter((o) => o.id !== a)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.instanceId.slice(0, 8)} · {o.boundarySegmentId} · {o.id.slice(-6)}
              </option>
            ))}
        </select>
      </label>
      <button
        disabled={
          !a ||
          !b ||
          a === b ||
          !available.some((o) => o.id === a) ||
          !available.some((o) => o.id === b)
        }
        onClick={() => {
          const id = current?.id ?? crypto.randomUUID();
          execute(current ? 'Изменение соединения' : 'Соединение проёмов', [
            { field: 'connections', id, value: { id, openingA: a, openingB: b } },
          ]);
        }}
      >
        {current ? 'Применить соединение' : 'Соединить'}
      </button>
    </section>
  );
}
function EnvironmentProperties({
  document,
  execute,
}: {
  document: Document;
  execute: (label: string, changes: Change[]) => void;
}) {
  const e = document.environment,
    change = (patch: Partial<Environment>) =>
      execute('Внешний вид', [
        { field: 'environment', value: { ...document.environment, ...patch } },
      ]);
  return (
    <div className="property-fields">
      <h3>Окружение</h3>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={e.roof}
          onChange={(event) => change({ roof: event.target.checked })}
        />
        Крыша
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={e.translucentFabric}
          onChange={(event) => change({ translucentFabric: event.target.checked })}
        />
        Просвечивание ткани
      </label>
      <label>
        Цвет ткани
        <input
          key={e.wallColor}
          type="color"
          defaultValue={e.wallColor}
          onBlur={(event) => {
            if (event.target.value !== e.wallColor) change({ wallColor: event.target.value });
          }}
        />
      </label>
      <NumberField
        label="День августа"
        value={e.sun.day}
        min={1}
        max={31}
        step={1}
        change={(day) => change({ sun: { ...e.sun, day } })}
      />
      <NumberField
        label="Время солнца, мин от полуночи"
        value={e.sun.minutes}
        min={0}
        max={1439}
        step={15}
        change={(minutes) => change({ sun: { ...e.sun, minutes } })}
      />
      <label>
        Сторона леса
        <select
          value={e.forest.side}
          onChange={(event) =>
            change({
              forest: { ...e.forest, side: event.target.value as Environment['forest']['side'] },
            })
          }
        >
          <option value="north">Север</option>
          <option value="east">Восток</option>
          <option value="south">Юг</option>
          <option value="west">Запад</option>
        </select>
      </label>
      <NumberField
        label="Расстояние до леса, м"
        value={e.forest.distance}
        min={0}
        change={(distance) => change({ forest: { ...e.forest, distance } })}
      />
      <NumberField
        label="Смещение леса, м"
        value={e.forest.offset}
        change={(offset) => change({ forest: { ...e.forest, offset } })}
      />
      <p>Солнце, лес, цвет и крыша сохраняются как условия прохождения.</p>
    </div>
  );
}
function SiteProperties({
  document,
  execute,
  error,
}: {
  document: Document;
  execute: (label: string, changes: Change[]) => void;
  error: (error: unknown) => void;
}) {
  const [loopId, setLoopId] = useState(
    document.site.boundaryLoops.find((l) => l.role === 'outer')!.id,
  );
  const loop =
    document.site.boundaryLoops.find((l) => l.id === loopId) ?? document.site.boundaryLoops[0]!;
  const canonicalLoop = useMemo(() => JSON.stringify(loop), [loop]);
  const [text, setText] = useState('');
  useEffect(
    () =>
      setText(
        loop.segments
          .flatMap((s) => sampleSegment(s).slice(0, -1))
          .map((p) => `${p.x}, ${p.z}`)
          .join('\n'),
      ),
    [loop.id, canonicalLoop],
  );
  const apply = () => {
    try {
      const lines = text.trim().split(/\n+/);
      if (lines.length < 3 || lines.length > 100_000) throw new Error('Нужно 3–100000 вершин');
      const points = lines.map((line) => {
        const values = line
          .trim()
          .split(/[,;\s]+/)
          .map(Number);
        if (values.length !== 2 || values.some((v) => !Number.isFinite(v)))
          throw new Error('Каждая строка: X, Z в метрах');
        return { x: values[0]!, z: values[1]! };
      });
      const updated: BoundaryLoop = {
        ...loop,
        segments: points.map((from, i) => ({
          id: loop.segments[i]?.id ?? `${loop.id}-${i}`,
          kind: 'line',
          from,
          to: points[(i + 1) % points.length]!,
        })),
      };
      execute('Контур площадки', [
        {
          field: 'site',
          value: {
            boundaryLoops: document.site.boundaryLoops.map((l) => (l.id === loop.id ? updated : l)),
          },
        },
      ]);
    } catch (e) {
      error(e);
    }
  };
  return (
    <div className="property-fields">
      <h3>Площадка и конструкция</h3>
      <NumberField
        label="Высота стен, м"
        value={document.physicalProfile.wallHeightM}
        min={1.8}
        max={10}
        change={(wallHeightM) =>
          execute('Высота стен', [
            { field: 'physicalProfile', value: { ...document.physicalProfile, wallHeightM } },
          ])
        }
      />
      <label>
        Контур
        <select value={loop.id} onChange={(e) => setLoopId(e.target.value)}>
          {document.site.boundaryLoops.map((l) => (
            <option value={l.id} key={l.id}>
              {l.role === 'outer' ? 'Внешний контур' : 'Исключённая зона'} · {l.id.slice(-6)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Вершины X, Z · одна на строку
        <textarea
          rows={8}
          maxLength={1_000_000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {loop.segments.some((s) => s.kind === 'arc') && (
        <p>Применение списка заменит дуги полилинией.</p>
      )}
      <button onClick={apply}>Применить контур</button>
      <button
        onClick={() => {
          const id = crypto.randomUUID(),
            outer = document.site.boundaryLoops.find((loop) => loop.role === 'outer')!,
            box = bounds(outer.segments.flatMap((segment) => sampleSegment(segment))),
            p = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 },
            points = [
              { x: p.x - 1, z: p.z - 1 },
              { x: p.x + 1, z: p.z - 1 },
              { x: p.x + 1, z: p.z + 1 },
              { x: p.x - 1, z: p.z + 1 },
            ];
          execute('Исключённая зона', [
            {
              field: 'site',
              value: {
                boundaryLoops: [
                  ...document.site.boundaryLoops,
                  {
                    id,
                    role: 'hole',
                    segments: points.map((from, i) => ({
                      id: `${id}-${i}`,
                      kind: 'line',
                      from,
                      to: points[(i + 1) % 4]!,
                    })),
                  },
                ],
              },
            },
          ]);
          setLoopId(id);
        }}
      >
        Добавить исключённую зону
      </button>
      {loop.role === 'hole' && (
        <button
          onClick={() => {
            execute('Удаление зоны', [
              {
                field: 'site',
                value: {
                  boundaryLoops: document.site.boundaryLoops.filter((l) => l.id !== loop.id),
                },
              },
            ]);
            setLoopId(document.site.boundaryLoops.find((l) => l.role === 'outer')!.id);
          }}
        >
          Удалить исключённую зону
        </button>
      )}
    </div>
  );
}
