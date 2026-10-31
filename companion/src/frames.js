/**
 * Frame planning for a render. Recording time runs from 0 to `durationMs`; race time is
 * recording time minus `raceStartMs` (where the start signal sits in the file). Frame k of
 * an `fps` render shows race time `raceTimeOf(k)`. The page says, through the handle's
 * `key`, whether the picture changed since the last frame; a plan only repeats frames.
 */

/** How many frames cover the recording, the last one included. */
export function frameCount(durationMs, fps) {
  if (!(durationMs > 0) || !(fps > 0)) return 0;
  return Math.ceil((durationMs / 1000) * fps);
}

/** Race time (ms) frame k shows. */
export function raceTimeOf(k, fps, raceStartMs) {
  return (k * 1000) / fps - raceStartMs;
}

/**
 * Walk the frames: `seek(t)` returns the page's key for race time t, `shoot()` takes the
 * picture, `emit(png)` sends one frame. A frame is shot only when the key changed; the
 * same buffer is emitted again otherwise. Returns counts for the log.
 */
export async function walkFrames({ durationMs, fps, raceStartMs, seek, shoot, emit, onProgress }) {
  const n = frameCount(durationMs, fps);
  let lastKey = null;
  let png = null;
  let shots = 0;
  for (let k = 0; k < n; k++) {
    const key = await seek(raceTimeOf(k, fps, raceStartMs));
    if (key !== lastKey || png == null) {
      png = await shoot();
      shots++;
      lastKey = key;
    }
    await emit(png);
    if (onProgress && k % (fps * 10) === 0) onProgress(k, n);
  }
  return { frames: n, shots };
}

/** The ffmpeg argument lists; `fps` frames of PNG arrive on stdin. */
export function overlayArgs({ fps, codec, out }) {
  const input = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-i',
    'pipe:0'
  ];
  if (codec === 'prores')
    return [
      ...input,
      '-c:v',
      'prores_ks',
      '-profile:v',
      '4444',
      '-pix_fmt',
      'yuva444p10le',
      '-vendor',
      'apl0',
      out
    ];
  // VP9 with alpha: a transparent track most editors and browsers read.
  return [
    ...input,
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    '-b:v',
    '0',
    '-crf',
    '30',
    '-row-mt',
    '1',
    out
  ];
}

export function compositeArgs({ fps, recording, out, crf }) {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    recording,
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-i',
    'pipe:0',
    '-filter_complex',
    '[0:v][1:v]overlay=0:0:eof_action=repeat:format=auto[v]',
    '-map',
    '[v]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-shortest',
    out
  ];
}
