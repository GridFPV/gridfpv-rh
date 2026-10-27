<script lang="ts">
  /**
   * RotorHazard's Audio Control panel, ours: every rotorhazard.* audio setting its Run and
   * Settings pages offer, with the same values, so the cue engine here and RotorHazard's
   * own page play the same thing. The panel is pure: it shows `settings` and reports every
   * change through `onchange`; the page writes localStorage and feeds the engine.
   */
  import { Button, Input, Select } from '@gridfpv/components';
  import type { AudioSettings } from '../lib/cues.js';
  import { AUDIO_OPTIONS, sliderToVolume, volumeToSlider } from '../lib/audioSettings.js';

  let {
    settings,
    voices,
    languages,
    onchange,
    ontest,
    onexport,
    onimport,
    ondefaults
  }: {
    settings: AudioSettings;
    /** Speech voices this browser offers (SpeechSynthesis voice names). */
    voices: string[];
    /** RotorHazard's languages for its phrases (`language` event). */
    languages: Array<{ id: string; name: string }>;
    onchange: (next: AudioSettings) => void;
    ontest: (text: string) => void;
    onexport: () => void;
    onimport: (file: File) => void;
    ondefaults: () => void;
  } = $props();

  let testText = $state('This is a test of the voice settings');
  let importFile: File | null = $state(null);
  let confirmDefaults = $state(false);

  function set<K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) {
    onchange({ ...settings, [key]: value });
  }
  const selValue = (e: Event) => (e.currentTarget as HTMLSelectElement).value;
  const numValue = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;

  const callouts: Array<[keyof typeof AUDIO_OPTIONS, string]> = [
    ['voice_callsign', 'Pilot callsign'],
    ['voice_lap_count', 'Pilot lap number'],
    ['voice_lap_time', 'Pilot lap time'],
    ['voice_race_timer', 'Race clock'],
    ['voice_team_lap_count', 'Team/co-op lap total'],
    ['voice_race_winner', 'Race winner'],
    ['voice_if_node_finished', 'Laps after pilot done'],
    ['voice_split_timer', 'Secondary/split timer'],
    ['voice_race_leader', 'Race leader pilot']
  ];
  const beeps: Array<[keyof AudioSettings, string]> = [
    ['beep_on_first_pass_button', 'Beep on first pass'],
    ['beep_crossing_entered', 'Beep when a crossing starts'],
    ['beep_crossing_exited', 'Beep when a crossing ends'],
    ['beep_manual_lap_button', 'Beep on manual lap'],
    ['beep_race_leader_lap', 'Beep on race leader lap'],
    ['beep_race_winner_declared', 'Beep when the winner is declared'],
    ['beep_cluster_connect', 'Beep on cluster connect'],
    ['use_mp3_tones', 'Use MP3 tones']
  ];
</script>

<div class="panel" aria-label="Audio settings">
  <section>
    <h3>Voice</h3>
    <div class="grid">
      <label class="field" data-key="voice_language">
        <span>Voice</span>
        <Select
          value={settings.voice_language ?? ''}
          size="sm"
          onchange={(e: Event) => set('voice_language', selValue(e) || null)}
        >
          {#if !voices.includes(settings.voice_language ?? '')}
            <option value={settings.voice_language ?? ''}
              >{settings.voice_language || '(default)'}</option
            >
          {/if}
          {#each voices as v (v)}<option value={v}>{v}</option>{/each}
        </Select>
      </label>
      <label class="field" data-key="voice_string_language">
        <span>Voice language</span>
        <Select
          value={settings.voice_string_language}
          size="sm"
          onchange={(e: Event) => set('voice_string_language', selValue(e))}
        >
          <option value="match-timer">(Match timer language)</option>
          <option value="">English</option>
          {#each languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
        </Select>
      </label>
      <div class="field test">
        <span>Voice test</span>
        <div class="row">
          <Input size="sm" bind:value={testText} aria-label="Voice test text" />
          <Button size="sm" variant="secondary" onclick={() => ontest(testText)}>Play</Button>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h3>Callouts</h3>
    <div class="grid">
      {#each callouts as [key, label] (key)}
        <label class="field" data-key={key}>
          <span>{label}</span>
          <Select
            value={String(settings[key])}
            size="sm"
            onchange={(e: Event) => set(key, Number(selValue(e)))}
          >
            {#each AUDIO_OPTIONS[key] as [v, text] (v)}<option value={String(v)}>{text}</option
              >{/each}
          </Select>
        </label>
      {/each}
    </div>
  </section>

  <section>
    <h3>Levels</h3>
    <div class="grid">
      <label class="field" data-key="voice_volume">
        <span>Voice volume <output>{volumeToSlider(settings.voice_volume)}</output></span>
        <input
          type="range"
          min="0"
          max="100"
          value={volumeToSlider(settings.voice_volume)}
          onchange={(e) => set('voice_volume', sliderToVolume(numValue(e)))}
        />
      </label>
      <label class="field" data-key="voice_rate">
        <span>Voice rate <output>{settings.voice_rate.toFixed(2)}</output></span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.01"
          value={settings.voice_rate}
          onchange={(e) => set('voice_rate', numValue(e))}
        />
      </label>
      <label class="field" data-key="voice_pitch">
        <span>Voice pitch <output>{settings.voice_pitch.toFixed(2)}</output></span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.01"
          value={settings.voice_pitch}
          onchange={(e) => set('voice_pitch', numValue(e))}
        />
      </label>
      <label class="field" data-key="tone_volume">
        <span>Tone volume <output>{volumeToSlider(settings.tone_volume)}</output></span>
        <input
          type="range"
          min="0"
          max="100"
          value={volumeToSlider(settings.tone_volume)}
          onchange={(e) => set('tone_volume', sliderToVolume(numValue(e)))}
        />
      </label>
      <label class="field" data-key="indicator_beep_volume">
        <span
          >Indicator beeps volume <output>{volumeToSlider(settings.indicator_beep_volume)}</output
          ></span
        >
        <input
          type="range"
          min="0"
          max="100"
          value={volumeToSlider(settings.indicator_beep_volume)}
          onchange={(e) => set('indicator_beep_volume', sliderToVolume(numValue(e)))}
        />
      </label>
    </div>
  </section>

  <section>
    <h3>Beeps</h3>
    <div class="grid checks">
      {#each beeps as [key, label] (key)}
        <label class="check" data-key={key}>
          <input
            type="checkbox"
            checked={Boolean(settings[key])}
            onchange={(e) => set(key, checked(e) as AudioSettings[typeof key])}
          />
          {label}
        </label>
      {/each}
    </div>
  </section>

  <section class="actions">
    <Button size="sm" variant="secondary" onclick={onexport}>Export audio settings</Button>
    <label class="file">
      <input
        type="file"
        accept=".cfg,.txt,text/plain"
        aria-label="Audio settings file to import"
        onchange={(e) => (importFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
      />
    </label>
    <Button
      size="sm"
      variant="secondary"
      disabled={!importFile}
      onclick={() => {
        if (importFile) onimport(importFile);
        importFile = null;
      }}>Import audio settings</Button
    >
    {#if confirmDefaults}
      <span class="confirm" role="alert">
        Reset every audio setting in this browser to RotorHazard's defaults?
        <Button
          size="sm"
          variant="danger"
          onclick={() => {
            confirmDefaults = false;
            ondefaults();
          }}>Reset</Button
        >
        <Button size="sm" variant="ghost" onclick={() => (confirmDefaults = false)}>Keep</Button>
      </span>
    {:else}
      <Button size="sm" variant="ghost" onclick={() => (confirmDefaults = true)}
        >Set audio settings to defaults</Button
      >
    {/if}
  </section>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-3);
  }
  h3 {
    margin: 0 0 var(--gf-space-2);
    font-size: var(--gf-font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gf-text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--gf-space-2) var(--gf-space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-1);
  }
  .field > span {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .field output {
    float: right;
    color: var(--gf-text);
  }
  .row {
    display: flex;
    gap: var(--gf-space-1);
  }
  .check {
    display: flex;
    gap: var(--gf-space-1);
    align-items: center;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-2);
    align-items: center;
  }
  .confirm {
    display: inline-flex;
    gap: var(--gf-space-1);
    align-items: center;
  }
  input[type='range'] {
    width: 100%;
  }
</style>
