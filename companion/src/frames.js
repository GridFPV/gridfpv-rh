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

/**
 * sRGB's transfer, as ffmpeg `lutrgb` expressions over 16-bit values: OBS composites a
 * browser source in linear light (its texture decoded from sRGB, the blend done on linear
 * values, the result encoded back), which lets the picture through a 90 %-dark panel
 * noticeably brighter than a blend done on the encoded values would. The render matches
 * that, so a re-rendered run looks like the live one beside it.
 */
const LIN = 'if(lt(val/65535,0.04045),val/65535/12.92,pow((val/65535+0.055)/1.055,2.4))*65535';
const ENC = 'if(lt(val/65535,0.0031308),val/65535*12.92,1.055*pow(val/65535,1/2.4)-0.055)*65535';
const LUT = (e) => `lutrgb=r='${e}':g='${e}':b='${e}'`;

/**
 * The composite's filter graph. `linear` (the default) blends in linear light at 16 bits —
 * premultiplied overlay, as OBS does: out = lin(premul(src)) + lin(dst)·(1 − α) — then encodes
 * back; `srgb` is a plain overlay on the encoded values. The overlay frames are scaled to the
 * recording's size if they differ.
 */
export function compositeFilter(blend = 'linear') {
  if (blend !== 'linear') return '[0:v][1:v]overlay=0:0:eof_action=repeat:format=auto[v]';
  return [
    `[0:v]format=gbrp16le,${LUT(LIN)}[base]`,
    // The overlay at the recording's size, still 8-bit RGBA (alphaextract wants that), then
    // one copy premultiplied and linearised, one copy's alpha inverted as a 16-bit mask.
    '[1:v]format=rgba[o8]',
    '[o8][base]scale2ref=flags=bicubic[os][base2]',
    '[os]split[o1][o2]',
    `[o1]format=gbrap16le,premultiply=inplace=1,format=gbrp16le,${LUT(LIN)}[src]`,
    '[o2]alphaextract,negate,format=gray16le,split=3[a1][a2][a3]',
    '[a1][a2][a3]mergeplanes=map0s=0:map0p=0:map1s=1:map1p=0:map2s=2:map2p=0:format=gbrp16le[inv]',
    '[base2][inv]blend=all_mode=multiply:repeatlast=1[dst]',
    '[dst][src]blend=all_mode=addition:repeatlast=1[lin]',
    `[lin]${LUT(ENC)},format=yuv420p[v]`
  ].join(';');
}

/** The encoder's arguments at a given quality: CRF for x264, its nearest cousin elsewhere. */
export function encoderArgs(encoder, crf) {
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(crf), '-b:v', '0'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-global_quality', String(crf), '-look_ahead', '0'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf)];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf)];
  }
}

export function compositeArgs({ fps, recording, out, crf, blend = 'linear', videoEncoder }) {
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
    compositeFilter(blend),
    '-map',
    '[v]',
    '-map',
    '0:a?',
    ...encoderArgs(videoEncoder, crf),
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
