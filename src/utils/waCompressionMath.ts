import type {
  AutoRecommendation,
  EncodeSettings,
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

  // aspectMode === 'keep'
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

  // Audio bitrate budget: 128 kbps if audio exists, else 0
  const audioKbps = probe.hasAudio ? 128 : 0;

  // Target size cap in MB (default WA Safe = 14.2 MB, well below 16 MB hard cap)
  const capMb = settings.mode === 'auto' ? 14.2 : settings.useTargetSizeCap ? settings.targetSizeMb : 0;

  // Max total bitrate allowed to stay under capMb (94% safety factor for container overhead)
  const maxTotalKbpsFromCap =
    capMb > 0 ? Math.floor(((capMb * 1024 * 8) / effectiveDuration) * 0.94) : 12000;
  const maxVideoKbpsFromCap = Math.max(450, maxTotalKbpsFromCap - audioKbps);

  let resolvedRes: Exclude<ResolutionOption, 'auto'>;
  let crf: number;
  let maxVideoKbps: number;
  let targetFps: number;
  let reason: string;

  if (settings.mode === 'auto') {
    const srcShortEdge = Math.min(probe.width, probe.height);

    // If user explicitly picked a resolution even in Auto mode, honor it; otherwise auto-pick!
    if (settings.resolution !== 'auto') {
      resolvedRes = settings.resolution;
    } else if (effectiveDuration <= 22 && srcShortEdge >= 1000 && maxVideoKbpsFromCap >= 3200) {
      resolvedRes = '1080p';
    } else if (srcShortEdge >= 640 && maxVideoKbpsFromCap >= 1350) {
      resolvedRes = '720p';
    } else if (maxVideoKbpsFromCap < 1350 && srcShortEdge > 540) {
      resolvedRes = '540p';
    } else {
      resolvedRes = '720p';
    }

    if (resolvedRes === '1080p') {
      maxVideoKbps = Math.min(3800, maxVideoKbpsFromCap);
      crf = 20;
      reason =
        'Klip berdurasi ringkas: 1080p Full HD dengan batas puncak 3.8 Mbps tetap muat di bawah batas 14.2 MB sehingga detail tetap tajam di Story WA.';
    } else if (resolvedRes === '720p') {
      maxVideoKbps = Math.min(2650, maxVideoKbpsFromCap);
      crf = 21;
      reason =
        'Sweet Spot Anti-Blur WA: 720p H.264 High@L4.0 dengan bitrate terkendali mencegah server WhatsApp melakukan kompresi ulang yang membuat buram.';
    } else if (resolvedRes === '540p') {
      maxVideoKbps = Math.min(1650, maxVideoKbpsFromCap);
      crf = 22;
      reason =
        'Durasi klip panjang: Resolusi 540p menjaga kerapatan piksel tetap bersih tanpa pecah (blocking) agar ukuran file aman di bawah batas unggah WA.';
    } else {
      maxVideoKbps = Math.min(3400, maxVideoKbpsFromCap);
      crf = 21;
      reason =
        'Mempertahankan resolusi asli dengan normalisasi codec H.264 8-bit SDR dan batas bitrate aman untuk unggahan WhatsApp.';
    }

    targetFps = probe.fps > 31 ? 30 : Math.max(15, Math.round(probe.fps || 30));
  } else {
    // Manual mode
    resolvedRes = settings.resolution === 'auto' ? '720p' : settings.resolution;
    crf = settings.crf;

    const defaultCeilingByRes: Record<Exclude<ResolutionOption, 'auto'>, number> = {
      '1080p': 4500,
      '720p': 2800,
      '540p': 1800,
      original: 4800,
    };

    maxVideoKbps = settings.useTargetSizeCap
      ? Math.min(defaultCeilingByRes[resolvedRes] + 1000, maxVideoKbpsFromCap)
      : defaultCeilingByRes[resolvedRes];

    if (settings.fps === '30') targetFps = 30;
    else if (settings.fps === '24') targetFps = 24;
    else targetFps = Math.min(60, Math.max(15, Math.round(probe.fps || 30)));

    reason = settings.useTargetSizeCap
      ? `Mode Manual dengan target batas maksimal ${capMb.toFixed(1)} MB dan kualitas CRF ${crf}.`
      : `Mode Manual berbasis kualitas CRF ${crf} dengan plafon bitrate ${(maxVideoKbps / 1000).toFixed(1)} Mbps.`;
  }

  const dims = computeTargetDimensions(
    probe.width,
    probe.height,
    resolvedRes,
    settings.aspectMode
  );

  // Estimate average bitrate (~78% of maxrate for constrained CRF, bounded by cap)
  const avgEstimatedVideoKbps = Math.min(maxVideoKbps, Math.round(maxVideoKbps * 0.82));
  const estimatedSizeMb = Math.max(
    0.2,
    ((avgEstimatedVideoKbps + audioKbps) * effectiveDuration) / 8 / 1024
  );

  return {
    resolvedResolution: resolvedRes,
    targetWidth: dims.width,
    targetHeight: dims.height,
    targetMaxBitrateKbps: maxVideoKbps,
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
