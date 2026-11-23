import type {
  AutoRecommendation,
  EncodeSettings,
  H264ProfileOption,
  ResolutionOption,
  VideoProbeInfo,
} from '../types/encoder.ts';

export function computeTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  resolution: Exclude<ResolutionOption, 'auto'>,
  aspectMode: EncodeSettings['aspectMode']
): { width: number; height: number } {
  const ensureEven = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

  if (aspectMode === 'fit916' || aspectMode === 'fill916') {
    if (resolution === '540p') return { width: 540, height: 960 };
    if (resolution === '720p') return { width: 720, height: 1280 };
    return { width: 1080, height: 1920 };
  }

  if (resolution === 'original') {
    return { width: ensureEven(srcWidth), height: ensureEven(srcHeight) };
  }

  const shortCap = resolution === '1080p' ? 1080 : resolution === '720p' ? 720 : 540;
  const longCap = resolution === '1080p' ? 1920 : resolution === '720p' ? 1280 : 960;

  const isPortrait = srcHeight >= srcWidth;
  const maxW = isPortrait ? shortCap : longCap;
  const maxH = isPortrait ? longCap : shortCap;

  const scaleRatio = Math.min(1, maxW / srcWidth, maxH / srcHeight);
  return {
    width: ensureEven(srcWidth * scaleRatio),
    height: ensureEven(srcHeight * scaleRatio),
  };
}

export function computeEncodingPlan(
  probe: Pick<VideoProbeInfo, 'width' | 'height' | 'duration' | 'fps' | 'hasAudio'>,
  settings: EncodeSettings
): AutoRecommendation {
  const start = Math.max(0, settings.trimStart || 0);
  const end =
    settings.trimEnd > start && settings.trimEnd <= probe.duration
      ? settings.trimEnd
      : probe.duration;
  const effectiveDuration = Math.max(1, end - start);

  // Verified PureStatus audio spec: 128 kbps AAC-LC 44.1 kHz (96k only in strict_bypass)
  const audioKbps = !probe.hasAudio
    ? 0
    : settings.mode === 'auto' && settings.waPreset === 'strict_bypass'
      ? 96
      : 128;

  // Target size cap in MB: 14.5 MB safe ceiling for WA media pass-through
  const capMb =
    settings.mode === 'auto'
      ? settings.waPreset === 'strict_bypass'
        ? 10.5
        : 14.5
      : settings.useTargetSizeCap
        ? settings.targetSizeMb
        : 0;

  const maxTotalKbpsFromCap =
    capMb > 0 ? Math.floor(((capMb * 1024 * 8) / effectiveDuration) * 0.94) : 12000;
  const maxVideoKbpsFromCap = Math.max(450, maxTotalKbpsFromCap - audioKbps);

  let resolvedRes: Exclude<ResolutionOption, 'auto'>;
  let crf: number;
  let maxVideoKbps: number;
  let targetFps: number;
  let h264Profile: H264ProfileOption;
  let h264Level: string;
  let reason: string;

  if (settings.mode === 'auto') {
    const srcShortEdge = Math.min(probe.width, probe.height);

    if (settings.resolution !== 'auto') {
      resolvedRes = settings.resolution;
    } else if (settings.waPreset === 'pure_hd_1080') {
      if (srcShortEdge >= 900 && maxVideoKbpsFromCap >= 2200) {
        resolvedRes = '1080p';
      } else if (srcShortEdge >= 640 && maxVideoKbpsFromCap >= 1100) {
        resolvedRes = '720p';
      } else {
        resolvedRes = '540p';
      }
    } else if (maxVideoKbpsFromCap < 1000 && srcShortEdge > 540) {
      resolvedRes = '540p';
    } else {
      resolvedRes = srcShortEdge < 640 ? '540p' : '720p';
    }

    if (settings.waPreset === 'pure_hd_1080') {
      // Exact verified PureStatus recipe: High@L4.0, CRF 20, vbv_maxrate=3800k, bufsize=5700k
      h264Profile = 'high';
      h264Level = resolvedRes === '1080p' || resolvedRes === 'original' ? '4.0' : '3.1';
      const ceiling = resolvedRes === '1080p' ? 3800 : resolvedRes === '720p' ? 2400 : 1400;
      maxVideoKbps = Math.min(ceiling, maxVideoKbpsFromCap);
      crf = 20;
      reason =
        'Resep PureHD 1080p (High@L4.0 · CRF 20 · max 3.8 Mbps · AAC 128k): menyamai profil encoding teruji agar video 1080p sangat tajam saat diteruskan lewat Bot ke Story WA.';
    } else if (settings.waPreset === 'balanced_720') {
      h264Profile = 'high';
      h264Level = resolvedRes === '1080p' ? '4.0' : '3.1';
      const ceiling = resolvedRes === '1080p' ? 2800 : resolvedRes === '720p' ? 2000 : 1200;
      maxVideoKbps = Math.min(ceiling, maxVideoKbpsFromCap);
      crf = 20;
      reason =
        'Mode 720p Tajam (High@L3.1 · CRF 20 · max 2.0 Mbps): cocok untuk durasi lebih panjang agar ukuran tetap hemat namun detail tetap bersih.';
    } else {
      h264Profile = 'baseline';
      h264Level = resolvedRes === '1080p' ? '4.0' : '3.1';
      const ceiling = resolvedRes === '1080p' ? 1800 : resolvedRes === '720p' ? 1250 : 850;
      maxVideoKbps = Math.min(ceiling, maxVideoKbpsFromCap);
      crf = 22;
      reason =
        'Mode Hemat / Ketat (Baseline@L3.1 · ~1.25 Mbps): ukuran file paling kecil untuk upload langsung tanpa forward bot.';
    }

    targetFps =
      probe.fps > 29.98
        ? 29.97
        : Math.max(15, Math.round((probe.fps || 29.97) * 100) / 100);
  } else {
    resolvedRes = settings.resolution === 'auto' ? '1080p' : settings.resolution;
    crf = settings.crf;
    h264Profile = settings.h264Profile || 'high';
    h264Level = resolvedRes === '1080p' || resolvedRes === 'original' ? '4.0' : '3.1';

    const defaultCeilingByRes: Record<Exclude<ResolutionOption, 'auto'>, number> = {
      '1080p': 3800,
      '720p': 2400,
      '540p': 1400,
      original: 3800,
    };

    maxVideoKbps = settings.useTargetSizeCap
      ? Math.min(defaultCeilingByRes[resolvedRes] + 400, maxVideoKbpsFromCap)
      : defaultCeilingByRes[resolvedRes];

    if (settings.fps === '30') targetFps = 30;
    else if (settings.fps === '24') targetFps = 24;
    else targetFps = Math.min(60, Math.max(15, Math.round(probe.fps || 30)));

    reason = settings.useTargetSizeCap
      ? `Mode Manual (${h264Profile.toUpperCase()}@L${h264Level}) dengan batas maksimal ${capMb.toFixed(1)} MB dan CRF ${crf}.`
      : `Mode Manual (${h264Profile.toUpperCase()}@L${h264Level}) dengan CRF ${crf} dan plafon ${(maxVideoKbps / 1000).toFixed(2)} Mbps.`;
  }

  const dims = computeTargetDimensions(
    probe.width,
    probe.height,
    resolvedRes,
    settings.aspectMode
  );

  const avgEstimatedVideoKbps = Math.min(maxVideoKbps, Math.round(maxVideoKbps * 0.88));
  const estimatedSizeMb = Math.max(
    0.2,
    ((avgEstimatedVideoKbps + audioKbps) * effectiveDuration) / 8 / 1024
  );

  return {
    resolvedResolution: resolvedRes,
    targetWidth: dims.width,
    targetHeight: dims.height,
    targetMaxBitrateKbps: maxVideoKbps,
    audioBitrateKbps: audioKbps,
    h264Profile,
    h264Level,
    crf,
    targetFps,
    estimatedSizeMb: Number(estimatedSizeMb.toFixed(2)),
    reason,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  if (mins === 0 && seconds < 10) {
    return `0:0${secs}.${tenths}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
