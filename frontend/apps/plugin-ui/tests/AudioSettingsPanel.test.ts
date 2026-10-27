import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import AudioSettingsPanel from '../src/components/AudioSettingsPanel.svelte';
import { AUDIO_DEFAULTS } from '../src/lib/cues.js';
import { AUDIO_KEYS } from '../src/lib/audioSettings.js';

function mount(settings = AUDIO_DEFAULTS) {
  const onchange = vi.fn();
  const ontest = vi.fn();
  const onexport = vi.fn();
  const onimport = vi.fn();
  const ondefaults = vi.fn();
  const r = render(AudioSettingsPanel, {
    settings,
    voices: ['Fake English', 'Fake French'],
    languages: [{ id: 'de', name: 'Deutsch' }],
    onchange,
    ontest,
    onexport,
    onimport,
    ondefaults
  });
  return { ...r, onchange, ontest, onexport, onimport, ondefaults };
}
const control = (c: HTMLElement, key: string) =>
  c.querySelector(`[data-key="${key}"] select, [data-key="${key}"] input`) as
    HTMLSelectElement | HTMLInputElement;

describe('AudioSettingsPanel', () => {
  it("offers a control for every audio setting RotorHazard's panel has", () => {
    const { container } = mount();
    for (const k of AUDIO_KEYS) expect(control(container, k), k).not.toBeNull();
  });
  it("reports each change with the whole settings object, in RotorHazard's values", async () => {
    const { container, onchange } = mount();
    const clock = control(container, 'voice_race_timer') as HTMLSelectElement;
    expect(clock.value).toBe('2');
    await fireEvent.change(clock, { target: { value: '0' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...AUDIO_DEFAULTS, voice_race_timer: 0 });
    const mp3 = control(container, 'use_mp3_tones') as HTMLInputElement;
    await fireEvent.click(mp3);
    expect(onchange).toHaveBeenLastCalledWith({ ...AUDIO_DEFAULTS, use_mp3_tones: true });
    const voice = control(container, 'voice_language') as HTMLSelectElement;
    await fireEvent.change(voice, { target: { value: 'Fake French' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...AUDIO_DEFAULTS, voice_language: 'Fake French' });
  });
  it("maps the volume sliders through RotorHazard's log scale: 0 is its floor, 100 is full", async () => {
    const { container, onchange } = mount();
    const tone = control(container, 'tone_volume') as HTMLInputElement;
    expect(tone.value).toBe('100');
    await fireEvent.change(tone, { target: { value: '0' } });
    const last = onchange.mock.lastCall![0] as typeof AUDIO_DEFAULTS;
    expect(last.tone_volume).toBeCloseTo(0.01, 10);
    const ind = control(container, 'indicator_beep_volume') as HTMLInputElement;
    expect(Number(ind.value)).toBe(85); // 0.5 on the log slider
  });
  it('plays the test text, exports, imports a chosen file, and resets only after a confirm', async () => {
    const { container, getByText, ontest, onexport, onimport, ondefaults } = mount();
    await fireEvent.click(getByText('Play'));
    expect(ontest).toHaveBeenCalledWith('This is a test of the voice settings');
    await fireEvent.click(getByText('Export audio settings'));
    expect(onexport).toHaveBeenCalledTimes(1);
    const importBtn = getByText('Import audio settings').closest('button')!;
    expect(importBtn.disabled).toBe(true);
    const file = new File(['rotorhazard.voice_rate=1.5\n'], 'a.cfg', { type: 'text/plain' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [file] } });
    expect(importBtn.disabled).toBe(false);
    await fireEvent.click(importBtn);
    expect(onimport).toHaveBeenCalledWith(file);
    await fireEvent.click(getByText('Set audio settings to defaults'));
    expect(ondefaults).not.toHaveBeenCalled();
    await fireEvent.click(getByText('Reset'));
    expect(ondefaults).toHaveBeenCalledTimes(1);
  });
});
