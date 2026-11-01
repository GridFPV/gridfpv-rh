import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Profiles, homeDir, profileFileName, sanitize } from '../src/profiles.js';

test('the home folder follows the platform, and GRIDFPV_VIDEO_HOME wins', () => {
  assert.equal(
    homeDir({ APPDATA: 'C:\\Users\\ryan\\AppData\\Roaming' }, 'win32'),
    path.join('C:\\Users\\ryan\\AppData\\Roaming', 'GridFPV Video')
  );
  assert.ok(homeDir({}, 'darwin').endsWith(path.join('Application Support', 'GridFPV Video')));
  assert.equal(homeDir({ XDG_CONFIG_HOME: '/cfg' }, 'linux'), path.join('/cfg', 'gridfpv-video'));
  assert.equal(homeDir({ GRIDFPV_VIDEO_HOME: '/portable' }, 'win32'), '/portable');
});

test('profile names become file names; unknown settings are refused', () => {
  assert.equal(profileFileName('Race day: Recon / 2026'), 'Race day- Recon - 2026.json');
  assert.throws(() => profileFileName('  '), /needs a name/);
  assert.deepEqual(sanitize({ timer: 'http://t', fps: 60 }), { timer: 'http://t', fps: 60 });
  assert.throws(() => sanitize({ nope: 1 }), /unknown setting "nope"/);
});

test('profiles are saved, listed, loaded, renamed and removed; state remembers the last one; a legacy config imports once', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gridfpv-profiles-'));
  const p = new Profiles({ dir });
  assert.deepEqual(await p.list(), []);
  await p.save('RaceGOW', { timer: 'http://recon-nh.local:5000/', layout: 'solo' });
  await p.save('Race day', {
    timer: 'http://recon-nh.local:5000',
    recordFrom: 'scene',
    scene: 'Clean'
  });
  assert.deepEqual(
    (await p.list()).map((x) => x.name),
    ['Race day', 'RaceGOW']
  );
  assert.deepEqual((await p.load('Race day')).settings, {
    timer: 'http://recon-nh.local:5000',
    recordFrom: 'scene',
    scene: 'Clean'
  });
  // Effective settings: the defaults underneath, the timer's trailing slash gone.
  const eff = Profiles.effective((await p.load('RaceGOW')).settings);
  assert.equal(eff.timer, 'http://recon-nh.local:5000');
  assert.equal(eff.fps, 30);
  assert.equal(eff.recordFrom, 'obs');

  await p.setState({ lastProfile: 'RaceGOW' });
  assert.equal((await p.state()).lastProfile, 'RaceGOW');
  await p.rename('RaceGOW', 'Practice');
  assert.deepEqual(
    (await p.list()).map((x) => x.name),
    ['Practice', 'Race day']
  );
  // Renaming the last-used profile away clears the pointer; removing does too.
  assert.equal((await p.state()).lastProfile, null);
  await p.setState({ lastProfile: 'Race day' });
  await p.remove('Race day');
  assert.deepEqual(
    (await p.list()).map((x) => x.name),
    ['Practice']
  );
  assert.equal((await p.state()).lastProfile, null);

  // The console companion's file: adopted only when there are no profiles yet.
  const legacy = path.join(dir, 'gridfpv-video.json');
  await fs.writeFile(legacy, JSON.stringify({ timer: 'http://x', obsPass: 'p' }));
  assert.equal(await p.importLegacy(legacy), null);
  await p.remove('Practice');
  const imported = await p.importLegacy(legacy);
  assert.deepEqual(imported, { name: 'Imported', settings: { timer: 'http://x', obsPass: 'p' } });
  assert.equal((await p.state()).lastProfile, 'Imported');
  assert.equal(await p.importLegacy(path.join(dir, 'missing.json')), null);
});
