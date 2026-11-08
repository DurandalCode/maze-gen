/** GPU check: real shader pixels must transmit a little nearby and nothing far away. */
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
    material.dispose(); panel.material.dispose(); panel.geometry.dispose(); renderer.dispose();
    return { near, far, disabled };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (results.near.transmission < 0.003 || results.near.transmission > 0.04 || results.near.brightest < 10)
    throw new Error(`Near fabric did not reveal fine pores: ${JSON.stringify({ transmission: results.near.transmission, brightest: results.near.brightest })}`);
  if (results.far.transmission > 0.0001 || results.disabled.transmission > 0.0001)
    throw new Error('Fabric must be opaque from far away and when the checkbox is off.');
  await mkdir('test-results', { recursive: true });
  for (const [name, result] of Object.entries(results))
    await Bun.write(`test-results/fabric-${name}.png`, Buffer.from(result.image.split(',')[1]!, 'base64'));
  console.log(`PASS: near transmission ${(results.near.transmission*100).toFixed(2)}%, far ${(results.far.transmission*100).toFixed(2)}%, checkbox off ${(results.disabled.transmission*100).toFixed(2)}%.`);
} finally { await Promise.race([browser.close(), Bun.sleep(5000)]); }
process.exit(0);
