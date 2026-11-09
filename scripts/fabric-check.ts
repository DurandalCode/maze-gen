/** GPU check: pores, distant HDR emitters, and opaque occlusion. Requires a running Vite server. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto('http://127.0.0.1:1420');
  const results = await page.evaluate(async () => {
    const threePath = '/node_modules/.vite/deps/three.js';
    const fabricPath = '/src/renderer/fabric-material.ts';
    const THREE = await import(threePath);
    const { fabricMaterial } = await import(fabricPath);
    const { sceneComposer } = await import('/src/renderer/scene-composer.ts');
    const { WorldLandmarks } = await import('/src/renderer/landmarks.ts');
    const { mazeMesh } = await import('/src/renderer/maze-mesh.ts');
    const { generate } = await import('/src/generators/generate.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(512, 512);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('white');
    const material = fabricMaterial('#000000', true);
    const panel = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 4), material, 1);
    panel.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 0, 0)); scene.add(panel);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    const measure = (distance: number) => {
      camera.position.set(3, 0, distance); camera.lookAt(3, 0, 0); renderer.render(scene, camera);
      const gl = renderer.getContext(), pixels = new Uint8Array(512*512*4);
      gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0, max = 0;
      for (let y = 224; y < 288; y++) for (let x = 224; x < 288; x++) {
        const red = pixels[(y*512+x)*4]!; sum += red; max = Math.max(max, red);
      }
      return { transmission: sum/(64*64*255), brightest: max, image: renderer.domElement.toDataURL('image/png') };
    };
    const near = measure(0.28), far = measure(2);
    panel.material = fabricMaterial('#000000', false);
    const disabled = measure(0.28);
    panel.material.dispose(); panel.material = material;
    scene.background.set('black');
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    const composer = sceneComposer(renderer, scene, camera);
    const emitter = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(80, 64, 32) }));
    emitter.position.set(3, 0, -1); scene.add(emitter);
    const readPixel = () => {
      composer.render();
      const pixel = new Uint8Array(4), gl = renderer.getContext();
      gl.readPixels(256, 256, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[0]!;
    };
    const readCenter = () => {
      camera.position.set(3, 0, 2); camera.lookAt(3, 0, 0);
      return readPixel();
    };
    const brightEmitter = readCenter();
    emitter.material.color.setRGB(1, 1, 1);
    const ordinaryObject = readCenter();
    const landmarks = new WorldLandmarks({ width: 4, depth: 4 });
    const sun = landmarks.group.getObjectByName('sun-disc');
    const genericMaterial = emitter.material; emitter.material = sun.material;
    const sunThroughFabric = readCenter();
    panel.material = fabricMaterial('#000000', false);
    const opaqueFabric = readCenter();
    panel.material.dispose(); panel.material = material;
    const wood = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 'black' }));
    wood.position.set(3, 0, 0.1); scene.add(wood);
    const opaqueOccluder = readCenter();
    scene.remove(panel, wood);
    const maze = generate({ columns: 1, rows: 1, corridorWidth: 4,
      extraConnections: 0, seed: 'roof-light', algorithm: 'prim' });
    const roofPixels: number[] = [];
    const { disposeMeshes } = await import('/src/renderer/dispose.ts');
    for (const translucentFabric of [true, false]) {
      const group = mazeMesh({ ...maze, roof: true, translucentFabric });
      const roof = group.getObjectByName('roof');
      scene.add(roof);
      camera.position.set(maze.width/2, 1.7, maze.depth/2);
      camera.lookAt(maze.width/2, maze.wallHeight, maze.depth/2);
      emitter.position.set(maze.width/2, maze.wallHeight+1, maze.depth/2);
      emitter.rotation.x = Math.PI/2;
      roofPixels.push(readPixel());
      scene.remove(roof); group.add(roof); disposeMeshes(group);
    }
    wood.geometry.dispose(); wood.material.dispose(); genericMaterial.dispose(); emitter.geometry.dispose();
    disposeMeshes(landmarks.group);
    composer.passes.forEach((pass: { dispose(): void }) => pass.dispose()); composer.dispose();
    material.dispose(); panel.geometry.dispose(); renderer.dispose();
    return { near, far, disabled, light: { brightEmitter, ordinaryObject, sunThroughFabric, opaqueFabric, opaqueOccluder }, roofPixels };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (results.near.transmission < 0.003 || results.near.transmission > 0.04 || results.near.brightest < 10)
    throw new Error(`Near fabric did not reveal fine pores: ${JSON.stringify({ transmission: results.near.transmission, brightest: results.near.brightest })}`);
  if (results.far.transmission < 0.005 || results.far.transmission > 0.02 || results.disabled.transmission > 0.0001)
    throw new Error('Fabric must transmit 1% from far away and remain opaque when the checkbox is off.');
  const light = results.light;
  if (light.brightEmitter < 150 || light.sunThroughFabric < 150 || light.ordinaryObject > 40
    || light.opaqueFabric > 0 || light.opaqueOccluder > 0)
    throw new Error(`HDR transmission or opaque occlusion failed: ${JSON.stringify(light)}`);
  if (results.roofPixels[0]! < 150 || results.roofPixels[1]! > 0)
    throw new Error(`Roof must transmit sunlight only with fabric enabled: ${JSON.stringify(results.roofPixels)}`);
  await mkdir('test-results', { recursive: true });
  for (const [name, result] of Object.entries({ near: results.near, far: results.far, disabled: results.disabled }))
    await Bun.write(`test-results/fabric-${name}.png`, Buffer.from(result.image.split(',')[1]!, 'base64'));
  console.log(`PASS: near transmission ${(results.near.transmission*100).toFixed(2)}%, far ${(results.far.transmission*100).toFixed(2)}%, checkbox off ${(results.disabled.transmission*100).toFixed(2)}%.`);
  console.log(`PASS: HDR light and occlusion: ${JSON.stringify(light)}`);
  console.log(`PASS: roof sunlight (fabric on/off): ${JSON.stringify(results.roofPixels)}`);
} finally { await Promise.race([browser.close(), Bun.sleep(5000)]); }
process.exit(0);
