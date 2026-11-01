/**
 * OBS over obs-websocket 5 (built into OBS 28+; Tools → WebSocket Server Settings). Three
 * calls: start, stop (which names the file), and how long the recording is right now — the
 * last is what pins the race start inside the file.
 */
import { EventEmitter } from 'node:events';
import OBSWebSocket from 'obs-websocket-js';

export class Obs extends EventEmitter {
  constructor(url, password, log = () => {}) {
    super();
    this.url = url;
    this.password = password;
    this.log = log;
    this.ws = new OBSWebSocket();
    this.connected = false;
    this.ws.on('ConnectionClosed', () => {
      if (this.connected) this.log('obs: connection closed');
      this.connected = false;
      this.emit('closed');
      this.retry();
    });
  }
  async connect() {
    try {
      const { obsWebSocketVersion } = await this.ws.connect(this.url, this.password || undefined);
      this.connected = true;
      const v = await this.ws.call('GetVersion').catch(() => ({}));
      this.log(
        `obs: connected — OBS ${v.obsVersion ?? '?'} on ${v.platform ?? '?'}, obs-websocket ${obsWebSocketVersion}`
      );
      this.emit('connected', {
        obsVersion: v.obsVersion,
        platform: v.platform,
        obsWebSocketVersion
      });
    } catch (e) {
      this.log(`obs: cannot connect to ${this.url}: ${e.message ?? e}`);
      this.retry();
    }
  }
  close() {
    clearTimeout(this.retryTimer);
    this.closing = true;
    return this.ws.disconnect();
  }
  retry() {
    if (this.closing) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), 5000);
    this.retryTimer.unref?.();
  }
  /** Milliseconds recorded so far, and whether a recording is on. */
  async recordStatus() {
    const r = await this.ws.call('GetRecordStatus');
    return {
      active: Boolean(r.outputActive),
      paused: Boolean(r.outputPaused),
      durationMs: Number(r.outputDuration)
    };
  }
  /**
   * Start, and return once the output is really running (`OUTPUT_STARTED`: frames flowing,
   * file time zero) — the caller's clock at that moment is where the file begins. The
   * output's own duration counter is not used for that: it counts encoded frames, which run
   * a lookahead or a B-frame queue behind the file's timeline (a second or more on x264 and
   * NVENC), and a start pinned by it lands early by that much.
   */
  async startRecord() {
    // OBS ignores a start that lands while the previous recording is still stopping, and
    // says nothing: if the output has not come up in a moment, ask once more.
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = this.nextState('OBS_WEBSOCKET_OUTPUT_STARTED', 2500);
      await this.ws.call('StartRecord').catch((e) => {
        if (!/already active/i.test(e.message ?? '')) throw e;
      });
      if (await started) return;
      if ((await this.recordStatus()).active) return;
      this.log('obs: the recording did not start; asking again');
    }
    throw new Error('OBS did not start recording');
  }
  /** Resolves true at the next RecordStateChanged with this state, false after `ms`. */
  nextState(state, ms) {
    return new Promise((resolve) => {
      const on = (e) => {
        if (e.outputState === state) {
          this.ws.off('RecordStateChanged', on);
          clearTimeout(t);
          resolve(true);
        }
      };
      const t = setTimeout(() => (this.ws.off('RecordStateChanged', on), resolve(false)), ms);
      t.unref?.();
      this.ws.on('RecordStateChanged', on);
    });
  }
  /**
   * Stops and returns the file OBS wrote — once OBS has finished writing it. `StopRecord`
   * answers while the output is still stopping; the file is whole at the `OUTPUT_STOPPED`
   * event, so wait for that (or give up after 20 s and return the path anyway).
   */
  async stopRecord() {
    const stopped = new Promise((resolve) => {
      const on = (e) => {
        if (e.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
          this.ws.off('RecordStateChanged', on);
          resolve(e.outputPath ?? null);
        }
      };
      this.ws.on('RecordStateChanged', on);
      setTimeout(() => (this.ws.off('RecordStateChanged', on), resolve(null)), 20_000).unref?.();
    });
    const r = await this.ws.call('StopRecord');
    const finalPath = await stopped;
    return finalPath ?? r.outputPath;
  }
}
