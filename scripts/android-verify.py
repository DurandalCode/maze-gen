#!/usr/bin/env python3
"""Check exact web payload and universal APK packaging without device/emulator."""
import hashlib
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
apk = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'outputs/maze-lab-android.apk'
with zipfile.ZipFile(apk) as package:
    names = set(package.namelist())
    assert 'classes.dex' in names and 'AndroidManifest.xml' in names, 'Missing Android runtime payload'
    assert not any(name.startswith('lib/') for name in names), 'Unexpected ABI-specific native library'
    expected = {f'assets/{path.relative_to(root / "dist").as_posix()}': path
                for path in (root / 'dist').rglob('*') if path.is_file()}
    actual = {name for name in names if name.startswith('assets/') and not name.endswith('/')}
    assert expected.keys() == actual, f'APK/dist asset mismatch: {expected.keys() ^ actual}'
    for name, path in expected.items():
        assert package.read(name) == path.read_bytes(), f'Stale or changed asset: {name}'
    index = package.read('assets/index.html').decode()
    assert 'src="/assets/' not in index and 'href="/assets/' not in index, 'Vite base must be relative'
    print(f'Payload verified: {len(expected)} exact dist assets; no native libraries.')
print(f'APK bytes: {apk.stat().st_size}')
print(f'SHA-256: {hashlib.sha256(apk.read_bytes()).hexdigest()}')
