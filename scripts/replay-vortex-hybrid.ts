import{resolve}from'node:path';
import{generate}from'../src/generators/generate';
import{deserialize,serialize}from'../src/persistence/maze-json';
const path=process.env.VORTEX_HYBRID_FILE??resolve('test-results/vortex-hybrid-deep-candidate.json'),expected=deserialize(await Bun.file(path).text()),started=performance.now(),actual=generate(expected.parameters);
if(serialize(actual)!==serialize(expected))throw Error('Ordinary seeded regeneration changed the native JSON');
console.log(JSON.stringify({replay:'byte-identical',milliseconds:Math.round(performance.now()-started),seed:actual.parameters.seed,baseSeed:actual.parameters.freeVortexBaseSeed}));
