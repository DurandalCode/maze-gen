import { readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
const root = resolve(import.meta.dir, '..'),
  apk = resolve(root, 'android-reboot/app/build/outputs/apk/debug/app-debug.apk');
const toolchain = process.env.MAZE_ANDROID_TOOLCHAIN ?? resolve(root, '../work/android-toolchain');
const sdk = process.env.ANDROID_HOME ?? resolve(toolchain, 'sdk');
const jdk = process.env.JAVA_HOME ?? resolve(toolchain, 'jdk-17.0.21+9/Contents/Home');
function run(command: string[], env = process.env): Uint8Array {
  const result = Bun.spawnSync(command, { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode) throw new Error(`${command[0]}: ${result.stderr.toString()}`);
  return result.stdout;
}
if (!existsSync(apk)) throw new Error('Сначала выполните bun run build:apk');
const sha = (data: Uint8Array | ArrayBuffer) =>
  new Bun.CryptoHasher('sha256').update(data).digest('hex');
const signatures = new TextDecoder().decode(
  run([resolve(sdk, 'build-tools/35.0.0/apksigner'), 'verify', '--verbose', '--print-certs', apk], {
    ...process.env,
    JAVA_HOME: jdk,
  }),
);
if (!signatures.includes('Verified using v2 scheme (APK Signature Scheme v2): true'))
  throw new Error('APK v2 signature is missing');
const badging = new TextDecoder().decode(
  run([resolve(sdk, 'build-tools/35.0.0/aapt'), 'dump', 'badging', apk]),
);
if (
  !badging.includes("package: name='lab.maze.reboot' versionCode='1' versionName='0.1.0-reboot'") ||
  !badging.includes("sdkVersion:'26'") ||
  !badging.includes("targetSdkVersion:'35'")
)
  throw new Error('Wrong APK package or versions');
const assets: { name: string; sha256: string; bytes: number }[] = [];
async function verify(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await verify(path);
      continue;
    }
    const name = relative(resolve(root, 'dist'), path),
      actual = run(['unzip', '-p', apk, `assets/${name}`]);
    const expected = await Bun.file(path).arrayBuffer();
    if (sha(actual) !== sha(expected))
      throw new Error(`APK contains stale or modified asset ${name}`);
    assets.push({ name, sha256: sha(actual), bytes: actual.byteLength });
  }
}
await verify(resolve(root, 'dist'));
const report = {
  verifiedAt: new Date().toISOString(),
  applicationId: 'lab.maze.reboot',
  apkSha256: sha(await Bun.file(apk).arrayBuffer()),
  signature: 'v2/debug',
  certificateSha256: signatures.match(/certificate SHA-256 digest: ([a-f0-9]+)/)?.[1],
  assets,
  deviceTest: 'not-run',
  physicalReason:
    'This verification script checks the archive and assets; it does not run a device',
};
await writeFile(
  resolve(root, 'reports/android/verification.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(`APK signature/package and ${assets.length} production assets verified`);
