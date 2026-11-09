import { useEffect, useState } from 'react';
import type { Construction } from '../core/maze';

export function ConstructionControls({ value, onChange }: {
  value: Construction;
  onChange: (patch: Partial<Construction>) => void;
}) {
  const [height, setHeight] = useState(String(value.wallHeight));
  useEffect(() => { setHeight(String(value.wallHeight)); }, [value.wallHeight]);
  return <fieldset className="construction-controls">
    <legend>ПАРАМЕТРЫ КОНСТРУКЦИИ</legend>
    <label className="field"><span>Высота стен</span><div className="input-unit">
      <input aria-label="Высота стен" type="number" min="1.8" max="10" step="0.1" value={height}
        onChange={event => {
          setHeight(event.target.value);
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next) && next >= 1.8 && next <= 10) onChange({ wallHeight: next });
        }}
        onBlur={() => setHeight(String(value.wallHeight))} />
      <em>м</em>
    </div></label>
    <label className="field"><span>Цвет стен</span><div className="wall-color-input">
      <input aria-label="Цвет стен" type="color" value={value.wallColor} onChange={event => onChange({ wallColor: event.target.value })} />
      <span>{value.wallColor.toUpperCase()}</span>
    </div></label>
    <label className="fabric-toggle"><input type="checkbox" checked={value.translucentFabric}
      onChange={event => onChange({ translucentFabric: event.target.checked })} /><span>Просвечивающая ткань</span></label>
    <p className="fabric-help">Мелкие просветы видны вблизи. При свете с обратной стороны стены просвечивают, а крыша показывает пятно из светящихся точек.</p>
    <label className="route-toggle construction-roof"><input type="checkbox" checked={value.roof} onChange={event => onChange({ roof: event.target.checked })} /><span className="switch" />Крыша над лабиринтом</label>
    <p>Применяются сразу · высота глаз 1,7 м</p>
  </fieldset>;
}
