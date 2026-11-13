import type {analyseDirectionMarkers} from '../analysis/direction-markers';
const time=(s:number)=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;
export function DirectionMarkerPanel({rows,visible,onVisible,selected,onSelect}:{rows:ReturnType<typeof analyseDirectionMarkers>;visible:boolean;onVisible:(value:boolean)=>void;selected:number;onSelect:(index:number)=>void}){
 if(!rows.length)return null;
 return <details className="direction-marker-panel" open aria-label="Метки предполагаемого выхода"><summary>Метки выхода · {rows.length}</summary>
  <label><input type="checkbox" checked={visible} onChange={e=>onVisible(e.target.checked)}/>Показывать стрелки меток</label>
  <p><span className="direction-marker-key">➜</span> Ощущение выхода в момент F. Синяя стрелка — ваш взгляд, не подсказка маршрута.</p>
  <p>Ошибка — угол к геометрическому положению финиша, не к кратчайшему пути. Движение — первый сдвиг ≥0,75 м в следующие 5 с.</p>
  <ol>{rows.map(row=><li key={row.index}><button aria-pressed={selected===row.index} onClick={()=>onSelect(row.index)}>{time(row.marker.time)} · {Math.round(row.bearing)}° · этаж {(row.marker.floor??0)+1}</button>
   <span>К финишу: {row.exitError===null?'у финиша':`${row.exitError.toFixed(0)}°`}. С движением: {row.movementError===null?'нет достаточного сдвига':`${row.movementError.toFixed(0)}° через ${row.movementSeconds!.toFixed(1)} с`}.</span>
  </li>)}</ol>
 </details>;
}
