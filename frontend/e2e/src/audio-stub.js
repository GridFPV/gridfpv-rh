/* eslint-disable */
// Playwright init script (#38 harness): stubs Web Audio and speechSynthesis so every tone
// and utterance a page makes lands in window.__cues with a wall-clock timestamp.
// Tones: RotorHazard's play_beep() = oscillator.start() then, `duration` ms later, a gain
// ramp to ~0; we record the start and close the cue on the ramp. MP3 tones: Audio.play().
// Speech: the articulate plugin builds a SpeechSynthesisUtterance and calls speak(); we
// emulate "speaking" for a plausible time so RotorHazard's heartbeat queue drains as it
// would with a real voice.
(() => {
  const cues = [];
  window.__cues = cues;
  window.__cueT0 = null; // set by the runner (wall-clock ms of race start)
  const now = () => Date.now();

  class FakeParam {
    constructor(v, owner, name) {
      this.value = v;
      this._owner = owner;
      this._name = name;
    }
    setValueAtTime(v) {
      this.value = v;
      return this;
    }
    linearRampToValueAtTime(v) {
      this._owner._ramp?.(this._name, v);
      return this;
    }
    exponentialRampToValueAtTime(v) {
      this._owner._ramp?.(this._name, v);
      return this;
    }
    setTargetAtTime(v) {
      this._owner._ramp?.(this._name, v);
      return this;
    }
    cancelScheduledValues() {
      return this;
    }
  }
  class FakeNode {
    constructor(ctx) {
      this.context = ctx;
      this._out = [];
    }
    connect(n) {
      this._out.push(n);
      return n;
    }
    disconnect() {}
  }
  class FakeGain extends FakeNode {
    constructor(ctx) {
      super(ctx);
      this.gain = new FakeParam(1, this, 'gain');
      this._cue = null;
    }
    _ramp(name, v) {
      if (name === 'gain' && this._cue && this._cue.duration_ms == null)
        this._cue.duration_ms = now() - this._cue.t;
    }
  }
  class FakeOsc extends FakeNode {
    constructor(ctx) {
      super(ctx);
      this.frequency = new FakeParam(440, this, 'frequency');
      this.detune = new FakeParam(0, this, 'detune');
      this.type = 'sine';
      this.onended = null;
    }
    start() {
      const gainNode = this._out.find((n) => n instanceof FakeGain);
      const cue = {
        kind: 'tone',
        t: now(),
        frequency: Math.round(this.frequency.value * 10) / 10,
        type: this.type,
        gain: gainNode ? gainNode.gain.value : null,
        duration_ms: null
      };
      if (gainNode) gainNode._cue = cue;
      cues.push(cue);
      this._cue = cue;
    }
    stop() {
      if (this._cue && this._cue.duration_ms == null) this._cue.duration_ms = now() - this._cue.t;
      if (this.onended) setTimeout(() => this.onended(), 0);
    }
  }
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = new FakeNode(this);
      this.sampleRate = 48000;
      Object.defineProperty(this, 'currentTime', { get: () => performance.now() / 1000 });
    }
    createOscillator() {
      return new FakeOsc(this);
    }
    createGain() {
      return new FakeGain(this);
    }
    createBufferSource() {
      return new FakeOsc(this);
    }
    createMediaElementSource() {
      return new FakeNode(this);
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    decodeAudioData() {
      return Promise.resolve({});
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;

  // <audio>.play(): RotorHazard's "MP3 tones" path.
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    cues.push({
      kind: 'mp3',
      t: now(),
      src: (this.currentSrc || this.src || '').split('/').pop(),
      volume: this.volume
    });
    return Promise.resolve();
  };
  void origPlay;

  // speechSynthesis
  const voices = [
    { name: 'Fake English', lang: 'en-US', default: true, localService: true, voiceURI: 'fake-en' },
    { name: 'Fake German', lang: 'de-DE', default: false, localService: true, voiceURI: 'fake-de' }
  ];
  let speakingUntil = 0;
  const synth = {
    get speaking() {
      return now() < speakingUntil;
    },
    get pending() {
      return false;
    },
    get paused() {
      return false;
    },
    onvoiceschanged: null,
    getVoices: () => voices,
    speak(u) {
      const words = String(u.text || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      const ms = Math.max(250, (words * 350) / (u.rate || 1));
      speakingUntil = now() + ms;
      cues.push({
        kind: 'speech',
        t: now(),
        text: String(u.text || '')
          .replace(/\s+/g, ' ')
          .trim(),
        rate: u.rate,
        pitch: u.pitch,
        volume: u.volume,
        voice: u.voice ? u.voice.name : null,
        emulated_ms: Math.round(ms)
      });
      setTimeout(() => {
        try {
          u.onstart && u.onstart({});
        } catch {}
      }, 0);
      setTimeout(() => {
        try {
          u.onend && u.onend({});
        } catch {}
      }, ms);
    },
    cancel() {
      speakingUntil = 0;
    },
    pause() {},
    resume() {},
    addEventListener() {},
    removeEventListener() {}
  };
  Object.defineProperty(window, 'speechSynthesis', {
    value: synth,
    configurable: true,
    writable: true
  });
  // Our own utterance class: the native one refuses a plain object as `voice`.
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text || '';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.lang = '';
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  };
  window.SpeechSynthesisUtterance.prototype.addEventListener = function () {};
  setTimeout(() => {
    try {
      synth.onvoiceschanged && synth.onvoiceschanged({});
    } catch {}
  }, 0);
})();
