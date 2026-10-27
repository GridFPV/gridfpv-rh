import { describe, expect, it } from 'vitest';
import { AUDIO_DEFAULTS } from '../src/lib/cues.js';
import {
  AUDIO_KEYS,
  exportAudioSettings,
  exportFileName,
  importAudioSettings,
  saveAudioSettings,
  sliderToVolume,
  volumeToSlider
} from '../src/lib/audioSettings.js';

describe('audio settings as RotorHazard stores and exports them', () => {
  it("maps the volume sliders like RotorHazard's LogSlider (0 ↔ 0.01, 100 ↔ 1)", () => {
    expect(sliderToVolume(0)).toBeCloseTo(0.01, 10);
    expect(sliderToVolume(100)).toBeCloseTo(1, 10);
    expect(volumeToSlider(1)).toBe(100);
    expect(volumeToSlider(0.01)).toBe(0);
    expect(volumeToSlider(sliderToVolume(50))).toBe(50);
    expect(volumeToSlider(0)).toBe(0);
  });
  it('exports every audio key as rotorhazard.<key>=<JSON> after a dated comment, and imports it back', () => {
    const s = {
      ...AUDIO_DEFAULTS,
      voice_rate: 1.5,
      voice_language: 'Fake English',
      use_mp3_tones: true
    };
    const text = exportAudioSettings(s, new Date(2026, 9, 27, 8, 5, 9));
    const lines = text.split('\n').filter(Boolean);
    expect(lines[0]).toMatch(/^# RotorHazard Audio Settings /);
    expect(lines.length).toBe(1 + AUDIO_KEYS.length);
    expect(lines).toContain('rotorhazard.voice_rate=1.5');
    expect(lines).toContain('rotorhazard.voice_language="Fake English"');
    expect(lines).toContain('rotorhazard.use_mp3_tones=true');
    const back = importAudioSettings(text);
    expect(back.settings).toEqual(s);
    expect(back.unknown).toEqual([]);
    expect(back.found).toBe(AUDIO_KEYS.length);
  });
  it("skips comments and blank lines, reports unknown keys, keeps the rest from the base (RotorHazard's parser)", () => {
    const r = importAudioSettings(
      '# a comment\n\nrotorhazard.tone_volume=0.5\nrotorhazard.nope=1\nnot a line\n',
      { ...AUDIO_DEFAULTS, voice_rate: 1.1 }
    );
    expect(r.settings.tone_volume).toBe(0.5);
    expect(r.settings.voice_rate).toBe(1.1);
    expect(r.unknown).toEqual(['rotorhazard.nope']);
    expect(r.found).toBe(1);
  });
  it('writes every key as JSON under rotorhazard.<key> and names the export file by date', () => {
    const store = new Map<string, string>();
    saveAudioSettings({ setItem: (k, v) => void store.set(k, v) }, AUDIO_DEFAULTS);
    expect(store.size).toBe(AUDIO_KEYS.length);
    expect(store.get('rotorhazard.voice_rate')).toBe('1.25');
    expect(store.get('rotorhazard.voice_string_language')).toBe('"match-timer"');
    // RotorHazard's own Set Defaults stores voice_language as null (#81), and so do ours.
    expect(store.get('rotorhazard.voice_language')).toBe('null');
    expect(exportAudioSettings(AUDIO_DEFAULTS, null)).toContain('rotorhazard.voice_language=null');
    expect(
      importAudioSettings('rotorhazard.voice_language=null\n').settings.voice_language
    ).toBeNull();
    expect(exportFileName(new Date(2026, 9, 27, 8, 5, 9))).toBe(
      'rhAudioSettings_20261027_080509.cfg'
    );
  });
});
