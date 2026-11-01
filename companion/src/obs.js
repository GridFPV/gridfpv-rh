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
  async startRecord() {
    await this.ws.call('StartRecord');
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
