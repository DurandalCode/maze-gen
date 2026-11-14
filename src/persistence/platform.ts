import {isTauri} from '@tauri-apps/api/core';
declare global {
 interface Window { MazeAndroid?:{exportData(filename:string,json:string):void;getPlatform():string} }
}
export const isAndroidApp=()=>typeof window!=='undefined'&&typeof window.MazeAndroid?.getPlatform==='function'&&window.MazeAndroid.getPlatform()==='android';
export const isOfflineLibrary=()=>isTauri()||isAndroidApp()||(typeof location!=='undefined'&&new URLSearchParams(location.search).get('offline')==='1');
export function downloadJson(filename:string,text:string):void{
 if(isAndroidApp()){window.MazeAndroid!.exportData(filename,text);return;}
 const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
export function pickJsonFile(maxBytes:number):Promise<string|null>{
 return new Promise((resolve,reject)=>{
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.addEventListener('cancel',()=>resolve(null),{once:true});input.addEventListener('change',()=>{
   const file=input.files?.[0];if(!file){resolve(null);return;}if(file.size>maxBytes){reject(new Error('Файл слишком большой.'));return;}
   file.text().then(resolve,reject);
  },{once:true});input.click();
 });
}
