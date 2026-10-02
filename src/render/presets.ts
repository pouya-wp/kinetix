// Platform delivery presets. Bitrates follow YouTube's published upload
// recommendations and current (2026) creator guidance for Instagram/TikTok.
// Edit freely — everything in the Render tab is derived from this table.

export type Codec = 'h264' | 'h265' | 'prores';
export interface RenderPreset {
  id: string;
  platform: 'YouTube' | 'Instagram' | 'TikTok' | 'X' | 'LinkedIn' | 'Facebook' | 'Master';
  label: string;
  sub: string;
  w: number;
  h: number;
  /** 'match' = comp frame rate (clamped to `maxFps`) */
  fps: 'match' | number;
  maxFps: number;
  /** video Mbps at ≤30 fps and at 48–60 fps */
  mbps: number;
  mbpsHigh: number;
  codec: Codec;
  audioKbps: number;
  tips: string[];
  badge?: string;
}

export const PRESETS: RenderPreset[] = [
  {
    id: 'yt-4k', platform: 'YouTube', label: 'YouTube 4K', sub: '3840×2160 · VP9/AV1 tier', w: 3840, h: 2160, fps: 'match', maxFps: 60, mbps: 45, mbpsHigh: 68, codec: 'h264', audioKbps: 384, badge: '4K',
    tips: ['YouTube recommends 35–45 Mbps (SDR, 24–30 fps) and 53–68 Mbps at 48–60 fps for 2160p.', '4K uploads get YouTube’s higher-quality VP9/AV1 encode even when watched at 1080p.'],
  },
  {
    id: 'yt-1440', platform: 'YouTube', label: '1440p “4K boost”', sub: '1080 content upscaled → better codec', w: 2560, h: 1440, fps: 'match', maxFps: 60, mbps: 24, mbpsHigh: 36, codec: 'h264', audioKbps: 384, badge: 'Trick',
    tips: ['Uploading 1440p makes YouTube use its VP9/AV1 encode — 1080p viewers get noticeably less compression.'],
  },
  {
    id: 'yt-1080', platform: 'YouTube', label: 'YouTube 1080p', sub: '1920×1080 · standard', w: 1920, h: 1080, fps: 'match', maxFps: 60, mbps: 12, mbpsHigh: 15, codec: 'h264', audioKbps: 384,
    tips: ['YouTube: 8 Mbps (24–30 fps) / 12 Mbps (60 fps) minimum; a little higher keeps fine motion graphics crisp.'],
  },
  {
    id: 'yt-shorts', platform: 'YouTube', label: 'Shorts', sub: '1080×1920 vertical', w: 1080, h: 1920, fps: 'match', maxFps: 60, mbps: 15, mbpsHigh: 20, codec: 'h264', audioKbps: 320,
    tips: ['Keep text inside the central safe area — the right edge and bottom are covered by the Shorts UI.'],
  },
  {
    id: 'yt-shorts-4k', platform: 'YouTube', label: 'Shorts 4K', sub: '2160×3840 vertical', w: 2160, h: 3840, fps: 'match', maxFps: 60, mbps: 45, mbpsHigh: 60, codec: 'h264', audioKbps: 320, badge: '4K',
    tips: ['Shorts accept 4K vertical uploads; the extra resolution survives YouTube’s re-encode better.'],
  },
  {
    id: 'ig-reels', platform: 'Instagram', label: 'Reels / Stories', sub: '1080×1920 · 9:16', w: 1080, h: 1920, fps: 'match', maxFps: 60, mbps: 20, mbpsHigh: 25, codec: 'h264', audioKbps: 256,
    tips: ['Instagram plays back at 1080p max — 4K uploads only add an extra compression pass.', 'Turn on Settings → Data usage → “Upload at highest quality” in the app.', 'Instagram caps around 25 Mbps; going higher does not help.'],
  },
  {
    id: 'ig-feed', platform: 'Instagram', label: 'Feed 4:5', sub: '1080×1350 portrait', w: 1080, h: 1350, fps: 'match', maxFps: 60, mbps: 15, mbpsHigh: 20, codec: 'h264', audioKbps: 256,
    tips: ['4:5 takes the most screen space in the feed.'],
  },
  {
    id: 'ig-square', platform: 'Instagram', label: 'Square 1:1', sub: '1080×1080', w: 1080, h: 1080, fps: 'match', maxFps: 60, mbps: 15, mbpsHigh: 20, codec: 'h264', audioKbps: 256,
    tips: ['Good for carousels.'],
  },
  {
    id: 'tiktok', platform: 'TikTok', label: 'TikTok', sub: '1080×1920 · HD', w: 1080, h: 1920, fps: 'match', maxFps: 60, mbps: 12, mbpsHigh: 20, codec: 'h264', audioKbps: 256,
    tips: ['Upload from TikTok Studio on desktop (not by AirDropping to your phone) for the sharpest result.', 'Enable “Allow high-quality uploads” before posting.'],
  },
  {
    id: 'tiktok-4k', platform: 'TikTok', label: 'TikTok 4K trick', sub: '2160×3840 vertical', w: 2160, h: 3840, fps: 'match', maxFps: 60, mbps: 40, mbpsHigh: 50, codec: 'h264', audioKbps: 256, badge: '4K',
    tips: ['TikTok re-encodes to its own ladder; a 4K source gives the encoder more detail and often looks sharper.'],
  },
  {
    id: 'x-landscape', platform: 'X', label: 'X / Twitter', sub: '1920×1080', w: 1920, h: 1080, fps: 'match', maxFps: 60, mbps: 15, mbpsHigh: 20, codec: 'h264', audioKbps: 256,
    tips: ['Max 2:20 for most accounts.'],
  },
  {
    id: 'x-vertical', platform: 'X', label: 'X vertical', sub: '1080×1920', w: 1080, h: 1920, fps: 'match', maxFps: 60, mbps: 15, mbpsHigh: 20, codec: 'h264', audioKbps: 256, tips: [],
  },
  {
    id: 'linkedin', platform: 'LinkedIn', label: 'LinkedIn', sub: '1920×1080', w: 1920, h: 1080, fps: 'match', maxFps: 60, mbps: 12, mbpsHigh: 15, codec: 'h264', audioKbps: 256, tips: [],
  },
  {
    id: 'facebook', platform: 'Facebook', label: 'Facebook feed', sub: '1080×1350', w: 1080, h: 1350, fps: 'match', maxFps: 60, mbps: 12, mbpsHigh: 15, codec: 'h264', audioKbps: 256, tips: [],
  },
  {
    id: 'master-prores', platform: 'Master', label: 'ProRes 422 HQ', sub: 'comp size · archive / edit', w: 0, h: 0, fps: 'match', maxFps: 120, mbps: 0, mbpsHigh: 0, codec: 'prores', audioKbps: 0, badge: 'Master',
    tips: ['Visually lossless master for editing or re-encoding later.'],
  },
  {
    id: 'master-hevc', platform: 'Master', label: 'H.265 10-bit', sub: 'comp size · small & clean', w: 0, h: 0, fps: 'match', maxFps: 120, mbps: 40, mbpsHigh: 60, codec: 'h265', audioKbps: 320, badge: 'Master',
    tips: ['10-bit HEVC avoids banding in gradients and glows.'],
  },
];

export interface Resolved { w: number; h: number; fps: number; mbps: number; maxMbps: number; codec: Codec; audioKbps: number; quality: 'fast' | 'balanced' | 'best'; name: string }

/** Final encode settings for a preset + overrides on a comp. */
export function resolve(p: RenderPreset, comp: { w: number; h: number; fps: number }, over: Record<string, any>): Resolved {
  const w = over.w ?? (p.w || comp.w);
  const h = over.h ?? (p.h || comp.h);
  const fps = over.fps ?? (p.fps === 'match' ? Math.min(p.maxFps, comp.fps) : p.fps);
  const mbps = over.mbps ?? (fps > 31 ? p.mbpsHigh : p.mbps);
  return { w: even(w), h: even(h), fps, mbps, maxMbps: +(mbps * 1.5).toFixed(1), codec: over.codec ?? p.codec, audioKbps: over.audioKbps ?? p.audioKbps, quality: over.quality ?? 'best', name: over.name ?? '{comp}_{preset}' };
}
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function ffmpegArgs(r: Resolved, input: string, output: string, srcW: number, srcH: number, hasAudio: boolean): string[] {
  const a = ['-y', '-hide_banner', '-i', input];
  const vf: string[] = [];
  if (srcW !== r.w || srcH !== r.h) vf.push(`scale=${r.w}:${r.h}:flags=lanczos`);
  const gop = Math.max(1, Math.round(r.fps / 2));
  if (r.codec === 'prores') {
    if (vf.length) a.push('-vf', vf.join(','));
    a.push('-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', '-r', String(r.fps));
    a.push(...(hasAudio ? ['-c:a', 'pcm_s16le', '-ar', '48000'] : ['-an']));
    a.push(output);
    return a;
  }
  vf.push(r.codec === 'h265' ? 'format=yuv420p10le' : 'format=yuv420p');
  a.push('-vf', vf.join(','));
  const preset = r.quality === 'best' ? 'slow' : r.quality === 'balanced' ? 'medium' : 'veryfast';
  if (r.codec === 'h265') {
    a.push('-c:v', 'libx265', '-preset', preset, '-tag:v', 'hvc1', '-x265-params', `keyint=${gop}:min-keyint=${gop}:bframes=2:no-open-gop=1`);
  } else {
    a.push('-c:v', 'libx264', '-preset', preset, '-profile:v', 'high', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-bf', '2', '-x264-params', 'open_gop=0:cabac=1');
  }
  a.push('-b:v', `${r.mbps}M`, '-maxrate', `${r.maxMbps}M`, '-bufsize', `${(r.mbps * 2).toFixed(1)}M`, '-r', String(r.fps));
  a.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
  a.push(...(hasAudio ? ['-c:a', 'aac', '-b:a', `${r.audioKbps}k`, '-ar', '48000', '-ac', '2'] : ['-an']));
  a.push('-movflags', '+faststart', output);
  return a;
}
