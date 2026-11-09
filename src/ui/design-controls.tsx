import {DEFAULT_DESIGN_LIMITS,type DesignLimits} from '../core/maze';
export function DesignControls({value,onChange}:{value:DesignLimits|undefined;onChange:(value:DesignLimits|undefined)=>void}){
 const field=(label:string,key:keyof Omit<DesignLimits,'allowReshape'>,min:number,max:number,scale=1,unit='')=><label className="field"><span>{label}</span><div className="input-unit"><input aria-label={label} type="number" min={min} max={max} step={key==='maxColdRegion'?4:1} value={Number.isNaN(value![key])?'':value![key]*scale} onChange={e=>onChange({...value!,[key]:e.target.valueAsNumber/scale})}/>{unit&&<em>{unit}</em>}</div></label>;
 return <fieldset className="design-controls"><legend>Пределы качества</legend>
  <label className="coldspot-check"><input type="checkbox" aria-label="Применять пределы качества" checked={!!value} onChange={e=>onChange(e.target.checked?{...DEFAULT_DESIGN_LIMITS}:undefined)}/> Применять пределы качества вместе</label>
  {value&&<><div className="design-grid">
   {field('Прямая без выбора, максимум','maxForcedStraight',2,40,1,'м')}
   {field('Проход без развилок, максимум','maxForcedRun',2,100,1,'м')}
   {field('Видимая прямая, максимум','maxVisibleStraight',2,24,1,'м')}
   {field('Холодная площадь, максимум','maxColdRatio',0,100,100,'%')}
   {field('Крупнейший колдспот, максимум','maxColdRegion',0,10000,1,'м²')}
  </div><p className="field-note">Ловушки, длины проходов и холодные области должны одновременно пройти проверку. Холодные области оцениваются для трёх стратегий отношения к границе; берётся худший результат модели.</p>
  <label className="coldspot-check"><input type="checkbox" aria-label="Разрешить изменение формы при подборе" checked={value.allowReshape} onChange={e=>onChange({...value,allowReshape:e.target.checked})}/> Если текущая форма не подходит, менять пропорции или расширять</label>
  {value.allowReshape&&field('Увеличение модулей, не более','maxModuleGrowth',0,100,100,'%')}
  </>}
 </fieldset>;
}
