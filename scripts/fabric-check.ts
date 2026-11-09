/** GPU check: near pores, front/back lighting, local lights, and both sides of the roof. */
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
    // Black metal removes reflected highlights so pixels measure transmission alone.
    material.metalness = 1;
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
    const backlight = new THREE.DirectionalLight('white', 2);
    backlight.position.set(3, 0, -2); backlight.target.position.set(3, 0, 0);
    scene.add(backlight, backlight.target);
    const farBack = measure(2);
    backlight.position.z = 2;
    const farFront = measure(2), nearFront = measure(0.28);
    backlight.position.z = -2;
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
    const readPixel = (x = 256, y = 256) => {
      composer.render();
      const pixel = new Uint8Array(4), gl = renderer.getContext();
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
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
    backlight.position.z = 2;
    const frontLitEmitter = readCenter();
    backlight.position.z = -2;
    const fill = new THREE.DirectionalLight('white', 8);
    fill.position.set(3, 0, 2); fill.target.position.set(3, 0, 0); scene.add(fill, fill.target);
    const dominantFrontLight = readCenter(); scene.remove(fill, fill.target);
    scene.remove(backlight);
    const point = new THREE.PointLight('white', 20, 10, 2);
    point.position.set(3, 0, -2); scene.add(point);
    const pointBack = readCenter(); point.position.z = 2;
    const pointFront = readCenter(); scene.remove(point);
    const spot = new THREE.SpotLight('white', 20, 10, Math.PI/4, 0, 2);
    spot.position.set(3, 0, -2); spot.target.position.set(3, 0, 0); scene.add(spot, spot.target);
    const spotBack = readCenter(); spot.target.position.z = -4;
    const spotMiss = readCenter(); spot.position.z = 2; spot.target.position.z = 0;
    const spotFront = readCenter(); scene.remove(spot, spot.target); scene.add(backlight);
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
    const roofSides: number[] = [];
    let roofDots = { min: 255, max: 0, adjacentContrast: 0, backgroundDifference: 0 }, roofImage = '';
    const { disposeMeshes } = await import('/src/renderer/dispose.ts');
    for (const translucentFabric of [true, false]) {
      const group = mazeMesh({ ...maze, roof: true, translucentFabric });
      const roof = group.getObjectByName('roof');
      roof.material.metalness = 1;
      scene.add(roof);
      camera.position.set(maze.width/2, 0.5, maze.depth/2);
      camera.lookAt(maze.width/2, maze.wallHeight, maze.depth/2);
      emitter.position.set(maze.width/2, maze.wallHeight+1, maze.depth/2);
      emitter.rotation.x = Math.PI/2;
      backlight.position.set(maze.width/2, 10, maze.depth/2);
      backlight.target.position.set(maze.width/2, maze.wallHeight, maze.depth/2);
      roofPixels.push(readPixel());
      if (translucentFabric) {
        // At the normal eye-to-roof distance, the spot must resolve into pores.
        camera.position.y = maze.wallHeight-0.8; readPixel();
        roofImage = renderer.domElement.toDataURL('image/png');
        const gl = renderer.getContext(), samples = new Uint8Array(24*24*4);
        gl.readPixels(244, 244, 24, 24, gl.RGBA, gl.UNSIGNED_BYTE, samples);
        let variation = 0;
        for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
          const i = (y*24+x)*4, red = samples[i]!;
          roofDots.min = Math.min(roofDots.min, red); roofDots.max = Math.max(roofDots.max, red);
          if (x) variation += Math.abs(red-samples[i-4]!);
        }
        roofDots.adjacentContrast = variation/(24*23);
        scene.background.set('white');
        const trees = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: '#00ff00' }));
        trees.position.set(maze.width/2, maze.wallHeight+0.5, maze.depth/2); trees.rotation.x = Math.PI/2; scene.add(trees);
        readPixel();
        const changed = new Uint8Array(samples.length);
        gl.readPixels(244, 244, 24, 24, gl.RGBA, gl.UNSIGNED_BYTE, changed);
        for (let i = 0; i < samples.length; i++) roofDots.backgroundDifference = Math.max(roofDots.backgroundDifference, Math.abs(changed[i]!-samples[i]!));
        scene.remove(trees); trees.geometry.dispose(); trees.material.dispose(); scene.background.set('black');
        camera.position.y = 0.5;
        backlight.position.y = 0; roofSides.push(readPixel());
        camera.position.y = maze.wallHeight+2; camera.lookAt(maze.width/2, maze.wallHeight, maze.depth/2);
        emitter.position.y = maze.wallHeight-1; emitter.rotation.x = -Math.PI/2;
        roofSides.push(readPixel()); backlight.position.y = 10; roofSides.push(readPixel());
      }
      scene.remove(roof); group.add(roof); disposeMeshes(group);
    }
    wood.geometry.dispose(); wood.material.dispose(); genericMaterial.dispose(); emitter.geometry.dispose();
    disposeMeshes(landmarks.group);
    composer.passes.forEach((pass: { dispose(): void }) => pass.dispose()); composer.dispose();
    material.dispose(); panel.geometry.dispose(); renderer.dispose();
    return { near, far, farBack, farFront, nearFront, disabled,
      light: { brightEmitter, ordinaryObject, sunThroughFabric, opaqueFabric, opaqueOccluder,
        frontLitEmitter, dominantFrontLight, pointBack, pointFront, spotBack, spotMiss, spotFront }, roofPixels, roofSides, roofDots, roofImage };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (results.near.transmission < 0.003 || results.near.transmission > 0.04 || results.near.brightest < 10)
    throw new Error(`Near fabric did not reveal fine pores: ${JSON.stringify({ transmission: results.near.transmission, brightest: results.near.brightest })}`);
  if (results.farBack.transmission < 0.005 || results.farBack.transmission > 0.02
    || results.far.transmission > 0.0001 || results.farFront.transmission > 0.0001 || results.disabled.transmission > 0.0001
    || Math.abs(results.nearFront.transmission-results.near.transmission) > 0.003)
    throw new Error('Distant fabric must transmit only with backlighting; near pores must remain unchanged.');
  const light = results.light;
  if (light.brightEmitter < 150 || light.sunThroughFabric < 150 || light.ordinaryObject > 40
    || light.opaqueFabric > 0 || light.opaqueOccluder > 0 || light.frontLitEmitter > 0 || light.dominantFrontLight > 0
    || light.pointBack < 150 || light.pointFront > 0 || light.spotBack < 150 || light.spotMiss > 0 || light.spotFront > 0)
    throw new Error(`HDR transmission or opaque occlusion failed: ${JSON.stringify(light)}`);
  if (results.roofPixels[0]! < 150 || results.roofPixels[1]! > 0)
    throw new Error(`Roof must transmit sunlight only with fabric enabled: ${JSON.stringify(results.roofPixels)}`);
  if (results.roofSides[0]! > 0 || results.roofSides[1]! < 150 || results.roofSides[2]! > 0)
    throw new Error(`Roof must distinguish front/back lighting from above and below: ${JSON.stringify(results.roofSides)}`);
  if (results.roofDots.max < 150 || results.roofDots.max-results.roofDots.min < 100
    || results.roofDots.adjacentContrast < 10 || results.roofDots.backgroundDifference > 0)
    throw new Error(`Roof spot must be dotted and hide the background: ${JSON.stringify(results.roofDots)}`);
  await mkdir('test-results', { recursive: true });
  await Bun.write('test-results/fabric-roof-dots.png', Buffer.from(results.roofImage.split(',')[1]!, 'base64'));
  for (const [name, result] of Object.entries({ near: results.near, far: results.far, 'far-back': results.farBack, 'far-front': results.farFront, disabled: results.disabled }))
    await Bun.write(`test-results/fabric-${name}.png`, Buffer.from(result.image.split(',')[1]!, 'base64'));
  console.log(`PASS: near transmission ${(results.near.transmission*100).toFixed(2)}%, far ${(results.far.transmission*100).toFixed(2)}%, checkbox off ${(results.disabled.transmission*100).toFixed(2)}%.`);
  console.log(`PASS: far backlit ${(results.farBack.transmission*100).toFixed(2)}%, frontlit ${(results.farFront.transmission*100).toFixed(2)}%; near frontlit ${(results.nearFront.transmission*100).toFixed(2)}%.`);
  console.log(`PASS: HDR light and occlusion: ${JSON.stringify(light)}`);
  console.log(`PASS: roof sunlight (fabric on/off): ${JSON.stringify(results.roofPixels)}`);
  console.log(`PASS: roof from below frontlit / above backlit / above frontlit: ${JSON.stringify(results.roofSides)}`);
  console.log(`PASS: dotted roof spot: ${JSON.stringify(results.roofDots)}`);
} finally { await Promise.race([browser.close(), Bun.sleep(5000)]); }
process.exit(0);
