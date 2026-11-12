import {DEFAULT_DESIGN_LIMITS,type DesignLimits} from '../core/maze';
import {defaultDesign,type LimitKey} from '../core/design-limits';
export function DesignControls({value,onChange,living=false,fixedShape=false,bridges=false}:{value:DesignLimits|undefined;onChange:(value:DesignLimits|undefined)=>void;living?:boolean;fixedShape?:boolean;bridges?:boolean}){
 const enabled=(key:LimitKey)=>!value?.disabledLimits?.includes(key)&&(key!=='maxUnavoidableRouteRatio'||value?.maxUnavoidableRouteRatio!==undefined)&&(key!=='maxColdSideRatio'||value?.maxColdSideRatio!==undefined);
 const toggle=(key:LimitKey,on:boolean)=>{
  const disabled=new Set(value?.disabledLimits??[]);if(on)disabled.delete(key);else disabled.add(key);
  const next={...value!,...(key==='maxUnavoidableRouteRatio'&&on?{maxUnavoidableRouteRatio:value?.maxUnavoidableRouteRatio??.7}:{}),...(key==='maxColdSideRatio'&&on?{maxColdSideRatio:value?.maxColdSideRatio??.12}:{}),...(disabled.size?{disabledLimits:[...disabled]}:{})};
  if(!disabled.size)delete next.disabledLimits;onChange(next);
 };
 const field=(label:string,key:LimitKey,min:number,max:number,scale=1,unit='')=><div className="quality-bound"><label className="coldspot-check"><input type="checkbox" aria-label={'Ограничивать: '+label} checked={enabled(key)} onChange={e=>toggle(key,e.target.checked)}/>{label}</label>{enabled(key)&&<label className="field"><div className="input-unit"><input aria-label={label} type="number" min={min} max={max} step={key==='maxColdRegion'?4:1} value={Number.isNaN(value![key])?'':(value![key]??1)*scale} onChange={e=>onChange({...value!,[key]:e.target.valueAsNumber/scale})}/>{unit&&<em>{unit}</em>}</div></label>}</div>;
 return <fieldset className="design-controls"><legend>Пределы качества</legend>
  <label className="coldspot-check"><input type="checkbox" aria-label="Применять пределы качества" checked={!!value} onChange={e=>onChange(e.target.checked?defaultDesign(living,DEFAULT_DESIGN_LIMITS):undefined)}/> Применять пределы качества вместе</label>
  {value&&<>{bridges&&<label className="coldspot-check"><input type="checkbox" aria-label="Длины наземных проходов отдельно от мостов" checked={!!value.groundOnlyLengths} onChange={e=>onChange({...value,groundOnlyLengths:e.target.checked})}/> Пределы длины — для наземных проходов; лестницы и верхние пролёты проверять отдельно</label>}<div className="design-grid">
   {field('Прямая без выбора, максимум','maxForcedStraight',2,40,1,'м')}
   {field('Проход без развилок, максимум','maxForcedRun',2,100,1,'м')}
   {field('Видимая прямая, максимум','maxVisibleStraight',2,24,1,'м')}
   {field('Холодная площадь, максимум','maxColdRatio',0,100,100,'%')}
   {field('Крупнейший колдспот, максимум','maxColdRegion',0,10000,1,'м²')}
   {field('Холодный боковой район, максимум','maxColdSideRatio',0,100,100,'%')}
   {field('Маршрут без обхода, максимум','maxUnavoidableRouteRatio',0,100,100,'%')}
  </div><p className="field-note">Включённые ограничения проверяются одновременно. Ограничение доли маршрута применяется при дополнительных соединениях. Для живого типа длинные контуры разрешены, пока вы явно не включите пределы длины. Отдельная тупиковая петля не считается обходом. Холодные области оцениваются для трёх стратегий отношения к границе.</p>
  <label className="coldspot-check"><input disabled={fixedShape} type="checkbox" aria-label="Разрешить изменение формы при подборе" checked={value.allowReshape} onChange={e=>onChange({...value,allowReshape:e.target.checked})}/> Если текущая форма не подходит, менять пропорции или расширять</label>
  {value.allowReshape&&<label className="field"><span>Увеличение модулей, не более</span><input aria-label="Увеличение модулей, не более" type="number" min="0" max="100" value={value.maxModuleGrowth*100} onChange={e=>onChange({...value,maxModuleGrowth:e.target.valueAsNumber/100})}/></label>}
  </>}
 </fieldset>;
}
