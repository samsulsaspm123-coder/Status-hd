import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type {
  EncodeJobStatus,
  EncodeSettings,
  VideoDiagnosticIssue,
  VideoProbeInfo,
} from '../types/encoder.ts';
import { computeEncodingPlan } from './waCompressionMath.ts';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

async function getBrowserFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (ffmpegLoadingPromise) {
    return ffmpegLoadingPromise;
  }

  ffmpegLoadingPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const coreURL = await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript');
    const wasmURL = await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm');
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadingPromise;
  } catch (err) {
    ffmpegLoadingPromise = null;
    throw err;
  }
}

function buildBrowserDiagnostics(
  fileSize: number,
  duration: number,
  width: number,
  height: number,
  videoBitrateKbps: number
): {
  waRiskLevel: 'high' | 'medium' | 'low';
  waRiskSummary: string;
  diagnostics: VideoDiagnosticIssue[];
} {
  const diagnostics: VideoDiagnosticIssue[] = [];
  let criticalCount = 0;
  let warningCount = 0;

  const sizeMb = fileSize / (1024 * 1024);
  if (sizeMb > 15.5) {
    criticalCount++;
    diagnostics.push({
      id: 'size',
      severity: 'critical',
      title: `Ukuran file terlalu besar (${sizeMb.toFixed(1)} MB)`,
      detail:
        'Batas aman Story WhatsApp sekitar 15–16 MB. File di atas batas ini akan dikompres ulang secara paksa dan drastis oleh WA.',
    });
  } else if (sizeMb > 12) {
    warningCount++;
    diagnostics.push({
      id: 'size',
      severity: 'warning',
      title: `Ukuran mendekati batas (${sizeMb.toFixed(1)} MB)`,
      detail:
        'Mengoptimalkannya ke kisaran 8–14 MB memberi margin aman agar tidak dipangkas server WA.',
    });
  } else {
    diagnostics.push({
      id: 'size',
      severity: 'ok',
      title: `Ukuran file aman (${sizeMb.toFixed(1)} MB)`,
      detail: 'Berada di bawah batas maksimal Story WhatsApp (16 MB).',
    });
  }

  if (videoBitrateKbps > 4500) {
    criticalCount++;
    diagnostics.push({
      id: 'bitrate',
      severity: 'critical',
      title: `Bitrate kamera tinggi (~${(videoBitrateKbps / 1000).toFixed(1)} Mbps)`,
      detail:
        'Video kamera dengan bitrate tinggi memicu transcoder agresif WhatsApp yang merusak ketajaman.',
    });
  } else if (videoBitrateKbps > 3950) {
    warningCount++;
    diagnostics.push({
      id: 'bitrate',
      severity: 'warning',
      title: `Bitrate di atas sweet spot (~${(videoBitrateKbps / 1000).toFixed(1)} Mbps)`,
      detail:
        'Mengunci bitrate puncak (maxrate) di kisaran 2.0–3.8 Mbps mencegah penurunan kualitas mendadak.',
    });
  } else {
    diagnostics.push({
      id: 'bitrate',
      severity: 'ok',
      title: `Bitrate efisien (~${(videoBitrateKbps / 1000).toFixed(2)} Mbps)`,
      detail: 'Cocok untuk streaming cepat dan minim risiko re-encode agresif.',
    });
  }

  const shortSide = Math.min(width, height);
  if (shortSide > 1080) {
    warningCount++;
    diagnostics.push({
      id: 'res',
      severity: 'warning',
      title: `Resolusi di atas 1080p (${width}×${height})`,
      detail:
        'Resolusi 2K/4K akan di-downscale paksa oleh WhatsApp dengan filter cepat yang membuat tepi objek terlihat lunak.',
    });
  }

  if (duration > 30.5) {
    warningCount++;
    diagnostics.push({
      id: 'duration',
      severity: 'warning',
      title: `Durasi ${duration.toFixed(1)} detik`,
      detail: 'Klip lebih dari 30 detik dapat terpotong pada beberapa versi WA.',
    });
  }

  const waRiskLevel: 'high' | 'medium' | 'low' =
    criticalCount > 0 ? 'high' : warningCount > 0 ? 'medium' : 'low';

  const waRiskSummary =
    waRiskLevel === 'high'
      ? 'Berisiko tinggi diburamkan oleh sistem WhatsApp jika diunggah langsung.'
      : waRiskLevel === 'medium'
        ? 'Perlu penyesuaian parameter agar ketajaman maksimal saat diunggah.'
        : 'Sudah cukup ramah untuk Story WhatsApp, namun tetap bisa dinormalisasi H.264.';

  return { waRiskLevel, waRiskSummary, diagnostics };
}

export function probeVideoInBrowser(
  file: File
): Promise<{ probe: VideoProbeInfo; blobUrl: string }> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    video.onloadedmetadata = () => {
      const width = video.videoWidth || 1080;
      const height = video.videoHeight || 1920;
      const duration = Number((Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1).toFixed(2));
      const totalBitrateKbps = Math.max(150, Math.round((file.size * 8) / duration / 1000));
      const videoBitrateKbps = Math.max(100, totalBitrateKbps - 128);

      const risk = buildBrowserDiagnostics(file.size, duration, width, height, videoBitrateKbps);
      const fileId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      resolve({
        blobUrl,
        probe: {
          fileId,
          fileName: file.name,
          fileSize: file.size,
          duration,
          width,
          height,
          codec: file.name.toLowerCase().endsWith('.mov') ? 'mov/h264' : 'mp4',
          profile: 'Browser',
          pixFmt: 'yuv420p',
          colorTransfer: 'bt709',
          isHdr: false,
          fps: 30,
          videoBitrateKbps,
          totalBitrateKbps,
          hasAudio: true,
          audioCodec: 'aac',
          audioBitrateKbps: 128,
          ...risk,
        },
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Gagal membaca metadata video di browser.'));
    };

    video.src = blobUrl;
  });
}

export async function generateSampleInBrowser(): Promise<{
  file: File;
  probe: VideoProbeInfo;
  blobUrl: string;
}> {
  const ffmpeg = await getBrowserFFmpeg();
  const sampleName = 'sample_high_bitrate.mp4';

  await ffmpeg.exec([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1080x1920:rate=30:duration=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=6',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-b:v',
    '9000k',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    sampleName,
  ]);

  const data = (await ffmpeg.readFile(sampleName)) as Uint8Array;
  await ffmpeg.deleteFile(sampleName);

  const file = new File([new Uint8Array(data)], 'Kamera_Story_1080p_HighBitrate.mp4', {
    type: 'video/mp4',
  });
  const { probe, blobUrl } = await probeVideoInBrowser(file);
  return { file, probe, blobUrl };
}

export async function encodeVideoInBrowser(
  file: File,
  probe: VideoProbeInfo,
  settings: EncodeSettings,
  onProgress: (progress: number) => void
): Promise<EncodeJobStatus> {
  const ffmpeg = await getBrowserFFmpeg();
  const plan = computeEncodingPlan(probe, settings);

  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
  const inputName = `in_${Date.now()}${ext}`;
  const outputName = `out_${Date.now()}.mp4`;

  const progressHandler = ({ progress }: { progress: number }) => {
    const pct = Math.min(99, Math.max(1, Math.round((progress || 0) * 100)));
    onProgress(pct);
  };
  ffmpeg.on('progress', progressHandler);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const start = Math.max(0, settings.trimStart || 0);
    const end =
      settings.trimEnd > start && settings.trimEnd <= probe.duration
        ? settings.trimEnd
        : probe.duration;
    const targetDuration = Math.max(0.5, end - start);

    const filters: string[] = [];
    if (settings.aspectMode === 'fit916') {
      filters.push(
        `scale=${plan.targetWidth}:${plan.targetHeight}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${plan.targetWidth}:${plan.targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`
      );
    } else if (settings.aspectMode === 'fill916') {
      filters.push(
        `scale=${plan.targetWidth}:${plan.targetHeight}:force_original_aspect_ratio=increase:flags=lanczos`,
        `crop=${plan.targetWidth}:${plan.targetHeight}`
      );
    } else {
      filters.push(`scale=${plan.targetWidth}:${plan.targetHeight}:flags=lanczos`);
    }
    filters.push('setsar=1');
    const isDownscaling = plan.targetWidth < probe.width || plan.targetHeight < probe.height;
    if (settings.sharpen && isDownscaling) {
      filters.push('unsharp=3:3:0.35:3:3:0.0');
    }
    filters.push('format=yuv420p');

    const args: string[] = ['-y'];
    if (start > 0.05) {
      args.push('-ss', start.toFixed(2));
    }
    args.push('-i', inputName);
    if (targetDuration < probe.duration - 0.1 || start > 0.05) {
      args.push('-t', targetDuration.toFixed(2));
    }

    const bufsizeKbps = Math.round(plan.targetMaxBitrateKbps * 1.5);
    const shouldForceFps =
      probe.fps > 29.98 ||
      (settings.mode === 'manual' && (settings.fps === '30' || settings.fps === '24'));

    args.push(
      '-map_metadata',
      '-1',
      '-vf',
      filters.join(','),
      '-c:v',
      'libx264',
      '-profile:v',
      plan.h264Profile,
      '-level',
      plan.h264Level,
      '-preset',
      'fast',
      '-crf',
      String(plan.crf),
      '-maxrate',
      `${plan.targetMaxBitrateKbps}k`,
      '-bufsize',
      `${bufsizeKbps}k`
    );

    if (shouldForceFps) {
      args.push('-r', String(plan.targetFps), '-vsync', 'cfr');
    }

    args.push(
      '-pix_fmt',
      'yuv420p',
      '-color_range',
      'tv',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      '-c:a',
      'aac',
      '-b:a',
      `${plan.audioBitrateKbps || 128}k`,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      outputName
    );

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error('FFmpeg browser gagal memproses video ini.');
    }

    const outBytes = (await ffmpeg.readFile(outputName)) as Uint8Array;
    const outBlob = new Blob([new Uint8Array(outBytes)], { type: 'video/mp4' });
    const outUrl = URL.createObjectURL(outBlob);

    const outSize = outBlob.size;
    const actualTotalKbps = Math.round((outSize * 8) / targetDuration / 1000);
    const actualVideoKbps = Math.max(100, actualTotalKbps - 128);
    const savingsPercent =
      probe.fileSize > 0
        ? Number((((probe.fileSize - outSize) / probe.fileSize) * 100).toFixed(1))
        : 0;

    const origBase = probe.fileName.replace(/\.[^.]+$/, '');
    const jobId = `browser_job_${Date.now()}`;

    return {
      jobId,
      fileId: probe.fileId,
      status: 'completed',
      progress: 100,
      fps: plan.targetFps,
      speed: '1x',
      startedAt: Date.now(),
      completedAt: Date.now(),
      settingsUsed: settings,
      recommendation: plan,
      output: {
        fileName: `${origBase}_WA_${plan.resolvedResolution}.mp4`,
        fileSize: outSize,
        duration: Number(targetDuration.toFixed(2)),
        width: plan.targetWidth,
        height: plan.targetHeight,
        codec: 'h264',
        pixFmt: 'yuv420p',
        fps: plan.targetFps,
        videoBitrateKbps: actualVideoKbps,
        totalBitrateKbps: actualTotalKbps,
        savingsPercent,
        downloadUrl: outUrl,
        streamUrl: outUrl,
      },
    };
  } finally {
    ffmpeg.off('progress', progressHandler);
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      // ignore
    }
  }
}
