import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '..');
const fallback = resolve(root, '../work/android-toolchain');
const toolchain = process.env.MAZE_ANDROID_TOOLCHAIN ?? (existsSync(fallback) ? fallback : null);
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  (toolchain ? resolve(toolchain, 'sdk') : '');
const jdk =
  process.env.JAVA_HOME ?? (toolchain ? resolve(toolchain, 'jdk-17.0.21+9/Contents/Home') : '');
const gradle =
  process.env.MAZE_GRADLE ??
  (toolchain
    ? resolve(toolchain, 'gradle-8.11.1/bin/gradle')
    : resolve(root, 'android-reboot/gradlew'));
if (
  !sdk ||
  !existsSync(resolve(sdk, 'platforms/android-35/android.jar')) ||
  !jdk ||
  !existsSync(resolve(jdk, 'bin/java'))
)
  throw new Error(
    'Нужны Android SDK platform 35/build-tools 35.0.0, JDK 17 и Gradle 8.11.1. Задайте ANDROID_HOME, JAVA_HOME и MAZE_GRADLE (или MAZE_ANDROID_TOOLCHAIN).',
  );
const version = Bun.spawnSync([gradle, '--version'], {
  cwd: resolve(root, 'android-reboot'),
  env: { ...process.env, JAVA_HOME: jdk },
  stdout: 'pipe',
  stderr: 'pipe',
});
if (version.exitCode !== 0 || !/Gradle 8\.11\.1(?:\s|$)/.test(version.stdout.toString()))
  throw new Error(
    'Нужен Gradle 8.11.1. Используйте android-reboot/gradlew или MAZE_ANDROID_TOOLCHAIN.',
  );
const build = Bun.spawn([process.execPath, 'run', 'build'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (await build.exited) throw new Error('Веб-сборка не прошла');
const assets = resolve(root, 'android-reboot/app/src/main/assets');
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await cp(resolve(root, 'dist'), assets, { recursive: true });
await writeFile(
  resolve(root, 'android-reboot/local.properties'),
  `sdk.dir=${sdk.replaceAll('\\', '\\\\')}\n`,
);
const gradleUser =
  process.env.GRADLE_USER_HOME ??
  (toolchain ? resolve(toolchain, 'gradle-user') : resolve(root, '.local-data/gradle'));
const result = Bun.spawn([gradle, '--offline', '--no-daemon', '--console=plain', 'assembleDebug'], {
  cwd: resolve(root, 'android-reboot'),
  env: { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, GRADLE_USER_HOME: gradleUser },
  stdout: 'inherit',
  stderr: 'inherit',
});
if (await result.exited)
  throw new Error(
    'APK build failed. Для первичного скачивания Gradle dependencies запустите assembleDebug без --offline.',
  );
const apk = resolve(root, 'android-reboot/app/build/outputs/apk/debug/app-debug.apk');
const digest = new Bun.CryptoHasher('sha256')
  .update(await Bun.file(apk).arrayBuffer())
  .digest('hex');
await mkdir(resolve(root, 'reports/android'), { recursive: true });
await writeFile(
  resolve(root, 'reports/android/build.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      applicationId: 'lab.maze.reboot',
      versionCode: 1,
      versionName: '0.1.0-reboot',
      compileSdk: 35,
      minSdk: 26,
      apk: 'android-reboot/app/build/outputs/apk/debug/app-debug.apk',
      sha256: digest,
      bytes: Bun.file(apk).size,
      gradle: '8.11.1',
      agp: '8.9.2',
      assets: 'production dist, offline trusted HTTPS origin',
      deviceTest: 'not-run',
    },
    null,
    2,
  ) + '\n',
);
console.log(`APK: ${apk}\nSHA-256: ${digest}`);
