import { environmentOf, type Environment } from '../core/environment';
import type { Maze } from '../core/maze';
import { solarPosition } from '../core/solar';

export function EnvironmentControls({ maze, onChange }: { maze: Maze; onChange: (environment: Environment) => void }) {
  const environment = environmentOf(maze), { sun, forest } = environment;
  const position = solarPosition(sun);
  const number = (label: string, value: number, min: number, max: number, change: (value: number) => void) =>
    <label className="field"><span>{label}</span><input aria-label={label} type="number" min={min} max={max} step="1"
      value={Math.round(value*10)/10} onChange={event => {
        const next = event.target.valueAsNumber;
        if (Number.isFinite(next) && next >= min && next <= max) change(next);
      }} /></label>;
  return <section className="environment-controls" aria-label="Ориентиры">
    <div className="section-label"><span>ОРИЕНТИРЫ</span><span>☀</span></div>
    <p>Москва · август · МСК (UTC+3). Север на карте — сверху.</p>
      <div className="field-pair">
        {number('День августа', sun.day, 1, 31, day => { if (Number.isInteger(day)) onChange({ ...environment, sun: { ...sun, day } }); })}
        <label className="field"><span>Время, МСК</span><input aria-label="Время, МСК" type="time"
          value={`${Math.floor(sun.minutes/60).toString().padStart(2, '0')}:${(sun.minutes%60).toString().padStart(2, '0')}`}
          onChange={event => { if (!event.target.value) return; const [hours, minutes] = event.target.value.split(':').map(Number);
            onChange({ ...environment, sun: { ...sun, minutes: hours!*60+minutes! } }); }} /></label>
      </div>
      <p className="sun-position">≈ {position.azimuth.toFixed(1)}° по компасу · высота {position.elevation.toFixed(1)}°{position.elevation < 0 ? ' · за горизонтом' : ''}</p>
    <p>Направление и высота солнца рассчитываются автоматически. Перетаскивайте его значок, чтобы выбрать ближайшее дневное время. Лес можно перетаскивать за подпись.</p>
    <label className="field"><span>Сторона леса</span><select aria-label="Сторона леса" value={forest.side}
      onChange={event => onChange({ ...environment, forest: { ...forest, side: event.target.value as typeof forest.side } })}>
      <option value="north">Север</option><option value="east">Восток</option><option value="south">Юг</option><option value="west">Запад</option>
    </select></label>
    <div className="field-pair">
      {number('Отступ леса, м', forest.distance, 2, 100, distance => onChange({ ...environment, forest: { ...forest, distance } }))}
      {number('Сдвиг леса, м', forest.offset, -2000, 2000, offset => onChange({ ...environment, forest: { ...forest, offset } }))}
    </div>
  </section>;
}
