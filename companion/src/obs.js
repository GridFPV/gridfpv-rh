/**
 * OBS over obs-websocket 5 (built into OBS 28+; Tools → WebSocket Server Settings). Three
 * calls: start, stop (which names the file), and how long the recording is right now — the
 * last is what pins the race start inside the file.
 */
import OBSWebSocket from "obs-websocket-js";

export class Obs {
  constructor(url, password, log = () => {}) {
    this.url = url;
    this.password = password;
    this.log = log;
    this.ws = new OBSWebSocket();
    this.connected = false;
    this.ws.on("ConnectionClosed", () => {
      if (this.connected) this.log("obs: connection closed");
      this.connected = false;
      this.retry();
    });
  }
  async connect() {
    try {
      const { obsVersion, obsWebSocketVersion } = await this.ws.connect(
        this.url,
        this.password || undefined,
      );
      this.connected = true;
      this.log(
        `obs: connected — OBS ${obsVersion}, obs-websocket ${obsWebSocketVersion}`,
      );
    } catch (e) {
      this.log(`obs: cannot connect to ${this.url}: ${e.message ?? e}`);
      this.retry();
    }
  }
  retry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), 5000);
    this.retryTimer.unref?.();
  }
  close() {
    clearTimeout(this.retryTimer);
    return this.ws.disconnect();
  }
  /** Milliseconds recorded so far, and whether a recording is on. */
  async recordStatus() {
    const r = await this.ws.call("GetRecordStatus");
    return {
      active: Boolean(r.outputActive),
      paused: Boolean(r.outputPaused),
      durationMs: Number(r.outputDuration),
    };
  }
  async startRecord() {
    await this.ws.call("StartRecord");
  }
  /** Stops and returns the file OBS wrote. */
  async stopRecord() {
    const r = await this.ws.call("StopRecord");
    return r.outputPath;
  }
}
