/** Dragging, settings, persistence and real 3D lighting. Requires Vite on port 1420. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { generate } from '../src/generators/generate';
import { DEFAULT_ENVIRONMENT, forestMapPoints, landmarkMapBounds } from '../src/core/environment';
import { solarPosition } from '../src/core/solar';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
try {
  await mkdir('test-results', { recursive: true });
  await page.goto('http://127.0.0.1:1420');
  const controls = page.getByRole('region', { name: 'Ориентиры', exact: true });
  await controls.waitFor();
  const maze = generate({ columns: 5, rows: 5, moduleSize: 2, corridorWidth: 2, extraConnections: 0, seed: '', algorithm: 'prim' });
  const bounds = landmarkMapBounds(maze), points = forestMapPoints(maze);
  const forest = points.reduce((sum, p) => ({ x: sum.x+p.x/4, z: sum.z+p.z/4 }), { x: 0, z: 0 });
  const drag = async (kind: 'forest' | 'sun') => {
    const canvas = page.locator('.map-canvas');
    await canvas.scrollIntoViewIfNeeded();
    let rect = (await canvas.boundingBox())!;
    const scale = Math.max(0.1, Math.min((rect.width-150)/(bounds.maxX-bounds.minX), (rect.height-160)/(bounds.maxZ-bounds.minZ)));
    const azimuth = solarPosition(DEFAULT_ENVIRONMENT.sun).azimuth*Math.PI/180;
    const divisor = Math.max(Math.abs(Math.sin(azimuth)), Math.abs(Math.cos(azimuth)));
    const start = kind === 'sun'
      ? { x: rect.width/2+Math.sin(azimuth)/divisor*((bounds.maxX-bounds.minX)*scale/2+28),
        y: rect.height/2-Math.cos(azimuth)/divisor*((bounds.maxZ-bounds.minZ)*scale/2+28) }
      : { x: rect.width/2+(forest.x-(bounds.minX+bounds.maxX)/2)*scale,
        y: rect.height/2+(forest.z-(bounds.minZ+bounds.maxZ)/2)*scale };
    await page.evaluate(y => window.scrollBy(0, y-window.innerHeight/2), rect.y+start.y);
    rect = (await canvas.boundingBox())!;
    const end = kind === 'sun' ? { x: rect.width/2-((bounds.maxX-bounds.minX)*scale/2+28), y: rect.height/2 }
      : { x: start.x+3*scale, y: start.y };
    await page.mouse.move(rect.x+start.x, rect.y+start.y); await page.mouse.down();
    await page.mouse.move(rect.x+end.x, rect.y+end.y, { steps: 12 }); await page.mouse.up();
  };
  await drag('sun');
  assert(Number((await controls.getByLabel('Время, МСК', { exact: true }).inputValue()).split(':')[0]) >= 17, 'Dragging sun west must choose evening');
  await drag('forest');
  assert(Math.abs(Number(await controls.getByLabel('Сдвиг леса, м', { exact: true }).inputValue())-3) < 0.2, 'Dragging forest must translate it');
  await controls.getByLabel('Сторона леса', { exact: true }).selectOption('east');
  await controls.getByLabel('Отступ леса, м', { exact: true }).fill('25');
  await controls.getByLabel('День августа', { exact: true }).fill('22');
  await controls.getByLabel('Время, МСК', { exact: true }).fill('00:00');
  assert((await controls.locator('.sun-position').innerText()).includes('за горизонтом'), 'Night must put sun below horizon');
  await page.getByRole('button', { name: 'Сгенерировать', exact: true }).click();
  assert(await controls.getByLabel('Время, МСК', { exact: true }).inputValue() === '00:00', 'Regeneration must retain time');
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await (await pendingDownload).saveAs('test-results/environment.json');
  const saved = JSON.parse(await Bun.file('test-results/environment.json').text());
  assert(saved.environment.forest.side === 'east' && saved.environment.forest.distance === 25, 'Forest must save');
  assert(saved.environment.sun.day === 22 && saved.environment.sun.minutes === 0, 'Time must save');
  await controls.getByLabel('Время, МСК', { exact: true }).fill('13:00');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await (await chooser).setFiles('test-results/environment.json');
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[aria-label="Время, МСК"]')?.value === '00:00');
  const rendered = await page.evaluate(async savedMaze => {
    const scenePath = '/src/renderer/scene.ts', environmentPath = '/src/core/environment.ts';
    const { WalkScene } = await import(scenePath), { sunDirection } = await import(environmentPath);
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:480px;height:320px'; document.body.append(canvas);
    const scene = new WalkScene(canvas);
    const snapshots = [];
    for (const minutes of [0, 13*60, 18*60]) {
      const maze = { ...savedMaze, environment: { ...savedMaze.environment, sun: { ...savedMaze.environment.sun, minutes } } };
      scene.setMaze(maze); scene.render({ position: { x: 5, z: 6 }, yaw: 0, pitch: 0 });
      const expected = sunDirection(maze.environment), actual = scene.sun.position.clone().sub(scene.sun.target.position).normalize();
      const dot = actual.x*expected.x+actual.y*expected.y+actual.z*expected.z;
      snapshots.push({ dot, visible: scene.landmarks.group.getObjectByName('sun-landmark').visible, intensity: scene.sun.intensity,
        forestX: scene.landmarks.group.getObjectByName('forest-landmark').position.x });
    }
    scene.dispose(); canvas.remove(); return snapshots;
  }, saved);
  assert(rendered.every(s => s.dot > 0.999999 && s.forestX === saved.width), 'Visible landmarks and light must share the configured positions');
  assert(!rendered[0]!.visible && rendered[0]!.intensity === 0 && rendered[1]!.visible && rendered[1]!.intensity > 0, 'Real 3D must hide sunlight at night and restore it by day');
  await page.screenshot({ path: 'test-results/environment-map.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: drag sun and forest, configure Moscow August time, regenerate, JSON roundtrip and real 3D lighting.');
} finally { await browser.close(); }
