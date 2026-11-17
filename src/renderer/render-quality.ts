export type RenderQuality='high'|'reduced';
const key='maze-lab:reduced-graphics';
export function qualitySettings(quality:RenderQuality,deviceRatio:number,maxSamples:number){return{pixelRatio:Math.min(deviceRatio,2)*(quality==='reduced'?.5:1),samples:quality==='reduced'?0:Math.min(4,maxSamples)};}
export function loadRenderQuality(storage?:Pick<Storage,'getItem'>):RenderQuality{try{return (storage??localStorage).getItem(key)==='1'?'reduced':'high';}catch{return'high';}}
export function saveRenderQuality(quality:RenderQuality,storage?:Pick<Storage,'setItem'>):void{try{(storage??localStorage).setItem(key,quality==='reduced'?'1':'0');}catch{/* Graphics remain usable with storage disabled. */}}
