import {migrateLibraries} from '../server/library-migration';
const args=Bun.argv.slice(2),out=args.indexOf('--out');
if(out<1||out!==args.length-2)throw Error('Usage: bun scripts/migrate-library.ts source-directory [another-source] --out new-directory');
const result=await migrateLibraries(args.slice(0,out),args[out+1]!);
console.log(JSON.stringify(result,null,2));
