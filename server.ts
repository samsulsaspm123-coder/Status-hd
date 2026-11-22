import express from 'express';
import multer from 'multer';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type {
  EncodeJobStatus,
  EncodeSettings,
  VideoDiagnosticIssue,
  VideoProbeInfo,
} from './src/types/encoder.ts';
import { computeEncodingPlan } from './src/utils/waCompressionMath.ts';

const execFileAsync = promisify(execFile);

const PORT = 3000;
const TEMP_ROOT = '/tmp/statusoptic';
const UPLOADS_DIR = path.join(TEMP_ROOT, 'uploads');
const OUTPUTS_DIR = path.join(TEMP_ROOT, 'outputs');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

interface StoredFileRecord {
  fileId: string;
  filePath: string;
  originalName: string;
  createdAt: number;
  probe: VideoProbeInfo;
}

interface StoredJobRecord {
  status: EncodeJobStatus;
  outputPath: string;
  createdAt: number;
}

const uploadedFiles = new Map<string, StoredFileRecord>();
const encodeJobs = new Map<string, StoredJobRecord>();

// Periodic cleanup of files older than 45 minutes
setInterval(() => {
  const cutoff = Date.now() - 45 * 60 * 1000;
  for (const [id, rec] of uploadedFiles.entries()) {
    if (rec.createdAt < cutoff) {
      fs.rmSync(rec.filePath, { force: true });
      uploadedFiles.delete(id);
    }
  }
  for (const [id, job] of encodeJobs.entries()) {
    if (job.createdAt < cutoff) {
      fs.rmSync(job.outputPath, { force: true });
      encodeJobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

function parseFps(rateStr?: string): number {
  if (!rateStr || rateStr === '0/0') return 30;
  const parts = rateStr.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num / den)) {
      return Number((num / den).toFixed(2));
    }
  }
  const parsed = Number(rateStr);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 30;
}

function analyzeWhatsAppRisk(info: Omit<VideoProbeInfo, 'waRiskLevel' | 'waRiskSummary' | 'diagnostics'>): {
  waRiskLevel: 'high' | 'medium' | 'low';
  waRiskSummary: string;
  diagnostics: VideoDiagnosticIssue[];
} {
  const diagnostics: VideoDiagnosticIssue[] = [];
  let criticalCount = 0;
  let warningCount = 0;

  const sizeMb = info.fileSize / (1024 * 1024);
  if (sizeMb > 15.5) {
    criticalCount++;
    diagnostics.push({
      id: 'size',
      severity: 'critical',
      title: `Ukuran file terlalu besar (${sizeMb.toFixed(1)} MB)`,
      detail: 'Batas aman Story WhatsApp sekitar 15–16 MB. File di atas batas ini akan dikompres ulang secara paksa dan drastis oleh WA.',
    });
  } else if (sizeMb > 12) {
    warningCount++;
    diagnostics.push({
      id: 'size',
      severity: 'warning',
      title: `Ukuran mendekati batas (${sizeMb.toFixed(1)} MB)`,
      detail: 'Masih bisa diunggah, tetapi mengoptimalkannya ke kisaran 8–14 MB memberi margin aman agar tidak dipangkas server WA.',
    });
  } else {
    diagnostics.push({
      id: 'size',
      severity: 'ok',
      title: `Ukuran file aman (${sizeMb.toFixed(1)} MB)`,
      detail: 'Berada di bawah batas maksimal Story WhatsApp (16 MB).',
    });
  }

  if (info.videoBitrateKbps > 4500) {
    criticalCount++;
    diagnostics.push({
      id: 'bitrate',
      severity: 'critical',
      title: `Bitrate kamera sangat tinggi (${(info.videoBitrateKbps / 1000).toFixed(1)} Mbps)`,
      detail: 'Video kamera bawaan (10–50 Mbps) memicu transcoder agresif WhatsApp yang merusak ketajaman menjadi ~1.2 Mbps.',
    });
  } else if (info.videoBitrateKbps > 3200) {
    warningCount++;
    diagnostics.push({
      id: 'bitrate',
      severity: 'warning',
      title: `Bitrate di atas sweet spot (${(info.videoBitrateKbps / 1000).toFixed(1)} Mbps)`,
      detail: 'Mengunci bitrate puncak (maxrate) di kisaran 2.2–3.5 Mbps mencegah penurunan kualitas mendadak saat diunggah.',
    });
  } else {
    diagnostics.push({
      id: 'bitrate',
      severity: 'ok',
      title: `Bitrate efisien (${(info.videoBitrateKbps / 1000).toFixed(2)} Mbps)`,
      detail: 'Cocok untuk streaming cepat dan minim risiko re-encode agresif.',
    });
  }

  const isStandardH264 = info.codec === 'h264' && info.pixFmt === 'yuv420p' && !info.isHdr;
  if (!isStandardH264) {
    criticalCount++;
    diagnostics.push({
      id: 'codec',
      severity: 'critical',
      title: `Format ${info.codec.toUpperCase()} / ${info.isHdr ? 'HDR 10-bit' : info.pixFmt}`,
      detail: 'WhatsApp mewajibkan H.264 8-bit SDR (yuv420p). Codec HEVC/HDR sering menghasilkan warna pudar dan buram setelah dikonversi WA.',
    });
  } else {
    diagnostics.push({
      id: 'codec',
      severity: 'ok',
      title: 'Codec kompatibel (H.264 8-bit SDR)',
      detail: 'Format warna yuv420p sesuai standar pemutar WhatsApp.',
    });
  }

  if (info.fps > 31) {
    warningCount++;
    diagnostics.push({
      id: 'fps',
      severity: 'warning',
      title: `Frame rate tinggi (${info.fps} fps)`,
      detail: 'Story WA menstandarkan video di 30 fps. Mengunci ke 30 fps CFR mengalokasikan lebih banyak bitrate per frame agar tiap gambar lebih tajam.',
    });
  }

  const shortSide = Math.min(info.width, info.height);
  if (shortSide > 1080) {
    warningCount++;
    diagnostics.push({
      id: 'res',
      severity: 'warning',
      title: `Resolusi di atas 1080p (${info.width}×${info.height})`,
      detail: 'Resolusi 2K/4K akan di-downscale paksa oleh WhatsApp dengan filter cepat yang membuat tepi objek terlihat lunak/buram.',
    });
  }

  if (info.duration > 30.5) {
    warningCount++;
    diagnostics.push({
      id: 'duration',
      severity: 'warning',
      title: `Durasi ${info.duration.toFixed(1)} detik`,
      detail: 'Klip lebih dari 30 detik dapat dipotong otomatis pada beberapa versi WA atau butuh kompresi lebih hemat per detiknya.',
    });
  }

  const waRiskLevel: 'high' | 'medium' | 'low' =
    criticalCount > 0 ? 'high' : warningCount > 0 ? 'medium' : 'low';

  const waRiskSummary =
    waRiskLevel === 'high'
      ? 'Berisiko tinggi diburamkan oleh sistem WhatsApp jika diunggah langsung.'
      : waRiskLevel === 'medium'
        ? 'Perlu penyesuaian parameter agar ketajaman maksimal saat diunggah.'
        : 'Sudah cukup ramah untuk Story WhatsApp, namun tetap bisa dioptimalkan ulang.';

  return { waRiskLevel, waRiskSummary, diagnostics };
}

async function probeVideoFile(
  filePath: string,
  fileId: string,
  originalName: string
): Promise<VideoProbeInfo> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; size?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      profile?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      color_transfer?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      bit_rate?: string;
      tags?: { rotate?: string };
      side_data_list?: Array<{ rotation?: number }>;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error('File tidak memiliki stream video yang valid.');
  }
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  let width = videoStream.width;
  let height = videoStream.height;

  // Account for rotation metadata (portrait phone recordings)
  let rotation = 0;
  if (videoStream.tags?.rotate) {
    rotation = Number(videoStream.tags.rotate) || 0;
  } else if (videoStream.side_data_list) {
    const rotEntry = videoStream.side_data_list.find((d) => typeof d.rotation === 'number');
    if (rotEntry && typeof rotEntry.rotation === 'number') {
      rotation = rotEntry.rotation;
    }
  }
  if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) {
    const tmp = width;
    width = height;
    height = tmp;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const duration = Number(parsed.format?.duration) || 1;
  const totalBitrateKbps = Math.round(
    (Number(parsed.format?.bit_rate) || (fileSize * 8) / duration) / 1000
  );
  const audioBitrateKbps = audioStream ? Math.round((Number(audioStream.bit_rate) || 128000) / 1000) : 0;
  const videoBitrateKbps = videoStream.bit_rate
    ? Math.round(Number(videoStream.bit_rate) / 1000)
    : Math.max(100, totalBitrateKbps - audioBitrateKbps);

  const colorTransfer = videoStream.color_transfer || 'bt709';
  const pixFmt = videoStream.pix_fmt || 'yuv420p';
  const isHdr =
    colorTransfer === 'smpte2084' ||
    colorTransfer === 'arib-std-b67' ||
    pixFmt.includes('10le') ||
    pixFmt.includes('10be');

  const baseInfo = {
    fileId,
    fileName: originalName,
    fileSize,
    duration: Number(duration.toFixed(2)),
    width,
    height,
    codec: videoStream.codec_name || 'unknown',
    profile: videoStream.profile || 'Standard',
    pixFmt,
    colorTransfer,
    isHdr,
    fps: parseFps(videoStream.avg_frame_rate || videoStream.r_frame_rate),
    videoBitrateKbps,
    totalBitrateKbps,
    hasAudio: Boolean(audioStream),
    audioCodec: audioStream?.codec_name || 'none',
    audioBitrateKbps,
  };

  const risk = analyzeWhatsAppRisk(baseInfo);
  return {
    ...baseInfo,
    ...risk,
  };
}

function streamFileWithRange(req: express.Request, res: express.Response, filePath: string, downloadName?: string) {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File tidak ditemukan atau sudah kedaluwarsa.' });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (downloadName) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

function buildFfmpegArgs(
  inputPath: string,
  outputPath: string,
  probe: VideoProbeInfo,
  settings: EncodeSettings,
  useHdrTonemap: boolean
): { args: string[]; targetDuration: number } {
  const start = Math.max(0, settings.trimStart || 0);
  const end =
    settings.trimEnd > start && settings.trimEnd <= probe.duration
      ? settings.trimEnd
      : probe.duration;
  const targetDuration = Math.max(0.5, end - start);

  const plan = computeEncodingPlan(probe, settings);

  const filters: string[] = [];

  if (useHdrTonemap && settings.normalizeHdr && probe.isHdr) {
    filters.push(
      'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv'
    );
  }

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

  if (settings.sharpen) {
    filters.push('unsharp=3:3:0.35:3:3:0.0');
  }

  filters.push('format=yuv420p');

  const args: string[] = ['-y'];

  if (start > 0.05) {
    args.push('-ss', start.toFixed(2));
  }

  args.push('-i', inputPath);

  if (targetDuration < probe.duration - 0.1 || start > 0.05) {
    args.push('-t', targetDuration.toFixed(2));
  }

  args.push(
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-profile:v',
    plan.h264Profile,
    '-level',
    plan.h264Level,
    '-preset',
    'medium',
    '-crf',
    String(plan.crf),
    '-maxrate',
    `${plan.targetMaxBitrateKbps}k`,
    '-bufsize',
    `${plan.targetMaxBitrateKbps * 2}k`,
    '-r',
    String(plan.targetFps),
    '-vsync',
    'cfr',
    '-g',
    String(plan.targetFps * 2),
    '-keyint_min',
    String(plan.targetFps),
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-pix_fmt',
    'yuv420p'
  );

  if (probe.hasAudio && plan.audioBitrateKbps > 0) {
    args.push('-c:a', 'aac', '-b:a', `${plan.audioBitrateKbps}k`, '-ar', '44100', '-ac', '2');
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath);

  return { args, targetDuration };
}

function runEncodeProcess(
  jobRecord: StoredJobRecord,
  inputPath: string,
  probe: VideoProbeInfo,
  settings: EncodeSettings,
  allowHdrRetry: boolean
) {
  const { args, targetDuration } = buildFfmpegArgs(
    inputPath,
    jobRecord.outputPath,
    probe,
    settings,
    allowHdrRetry && probe.isHdr && settings.normalizeHdr
  );

  jobRecord.status.status = 'processing';
  const totalUs = targetDuration * 1_000_000;
  let stderrTail = '';

  const proc = spawn('ffmpeg', args);

  proc.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    const lines = text.split('\n');
    for (const line of lines) {
      const [k, v] = line.split('=');
      if (!k || v === undefined) continue;
      const key = k.trim();
      const val = v.trim();
      if (key === 'out_time_us') {
        const us = Number(val);
        if (Number.isFinite(us) && totalUs > 0) {
          const pct = Math.min(99, Math.max(1, Math.round((us / totalUs) * 100)));
          jobRecord.status.progress = pct;
        }
      } else if (key === 'fps') {
        const fpsNum = Number(val);
        if (Number.isFinite(fpsNum)) {
          jobRecord.status.fps = Math.round(fpsNum);
        }
      } else if (key === 'speed') {
        jobRecord.status.speed = val;
      }
    }
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-1500);
  });

  proc.on('close', async (code) => {
    if (code !== 0) {
      // Fallback without zscale tonemap if HDR metadata caused zscale error
      if (allowHdrRetry && probe.isHdr && settings.normalizeHdr) {
        runEncodeProcess(jobRecord, inputPath, probe, settings, false);
        return;
      }
      jobRecord.status.status = 'error';
      jobRecord.status.error = 'Gagal memproses video dengan FFmpeg. Pastikan format video valid.';
      console.error('FFmpeg error:', stderrTail);
      return;
    }

    try {
      const outProbe = await probeVideoFile(
        jobRecord.outputPath,
        jobRecord.status.fileId,
        path.basename(jobRecord.outputPath)
      );
      const origBaseName = probe.fileName.replace(/\.[^.]+$/, '');
      const plan = jobRecord.status.recommendation;
      const downloadName = `${origBaseName}_WA_${plan.resolvedResolution}.mp4`;

      const savingsPercent =
        probe.fileSize > 0
          ? Number((((probe.fileSize - outProbe.fileSize) / probe.fileSize) * 100).toFixed(1))
          : 0;

      jobRecord.status.status = 'completed';
      jobRecord.status.progress = 100;
      jobRecord.status.completedAt = Date.now();
      jobRecord.status.output = {
        fileName: downloadName,
        fileSize: outProbe.fileSize,
        duration: outProbe.duration,
        width: outProbe.width,
        height: outProbe.height,
        codec: outProbe.codec,
        pixFmt: outProbe.pixFmt,
        fps: outProbe.fps,
        videoBitrateKbps: outProbe.videoBitrateKbps,
        totalBitrateKbps: outProbe.totalBitrateKbps,
        savingsPercent,
        downloadUrl: `/api/outputs/${jobRecord.status.jobId}/download`,
        streamUrl: `/api/outputs/${jobRecord.status.jobId}/stream`,
      };
    } catch (err) {
      jobRecord.status.status = 'error';
      jobRecord.status.error = err instanceof Error ? err.message : 'Gagal membaca hasil encode.';
    }
  });
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp4';
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: {
      fileSize: 350 * 1024 * 1024, // 350 MB
    },
  });

  app.post('/api/probe', upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Tidak ada file video yang diunggah.' });
        return;
      }

      const fileId = crypto.randomUUID();
      const probe = await probeVideoFile(req.file.path, fileId, req.file.originalname);

      uploadedFiles.set(fileId, {
        fileId,
        filePath: req.file.path,
        originalName: req.file.originalname,
        createdAt: Date.now(),
        probe,
      });

      res.json(probe);
    } catch (err) {
      if (req.file?.path) {
        fs.rmSync(req.file.path, { force: true });
      }
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Gagal menganalisis video. Pastikan file adalah video yang valid.',
      });
    }
  });

  app.post('/api/sample', async (_req, res) => {
    try {
      const fileId = crypto.randomUUID();
      const filePath = path.join(UPLOADS_DIR, `${fileId}.mp4`);

      // Generate a realistic high-bitrate 1080x1920 60fps 8s portrait video (~16.5 MB)
      // to demonstrate WhatsApp blur risk vs anti-blur compression
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1080x1920:rate=60:duration=8',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=8',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-b:v',
        '16500k',
        '-maxrate',
        '18000k',
        '-bufsize',
        '18000k',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        filePath,
      ]);

      const originalName = 'Kamera_Story_1080p_60fps_HighBitrate.mp4';
      const probe = await probeVideoFile(filePath, fileId, originalName);

      uploadedFiles.set(fileId, {
        fileId,
        filePath,
        originalName,
        createdAt: Date.now(),
        probe,
      });

      res.json(probe);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal membuat video sampel.',
      });
    }
  });

  app.post('/api/encode', (req, res) => {
    const body = req.body as { fileId?: string; settings?: EncodeSettings };
    if (!body?.fileId || !body?.settings) {
      res.status(400).json({ error: 'Parameter fileId dan settings wajib diisi.' });
      return;
    }

    const fileRec = uploadedFiles.get(body.fileId);
    if (!fileRec || !fs.existsSync(fileRec.filePath)) {
      res.status(404).json({ error: 'Video sumber tidak ditemukan. Silakan unggah ulang video.' });
      return;
    }

    const jobId = crypto.randomUUID();
    const outputPath = path.join(OUTPUTS_DIR, `${jobId}.mp4`);
    const recommendation = computeEncodingPlan(fileRec.probe, body.settings);

    const jobRecord: StoredJobRecord = {
      outputPath,
      createdAt: Date.now(),
      status: {
        jobId,
        fileId: body.fileId,
        status: 'queued',
        progress: 0,
        fps: 0,
        speed: '0x',
        startedAt: Date.now(),
        settingsUsed: body.settings,
        recommendation,
      },
    };

    encodeJobs.set(jobId, jobRecord);
    runEncodeProcess(jobRecord, fileRec.filePath, fileRec.probe, body.settings, true);

    res.json(jobRecord.status);
  });

  app.get('/api/jobs/:jobId', (req, res) => {
    const job = encodeJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Pekerjaan encode tidak ditemukan.' });
      return;
    }
    res.json(job.status);
  });

  app.get('/api/files/:fileId/stream', (req, res) => {
    const rec = uploadedFiles.get(req.params.fileId);
    if (!rec) {
      res.status(404).json({ error: 'File tidak ditemukan.' });
      return;
    }
    streamFileWithRange(req, res, rec.filePath);
  });

  app.get('/api/outputs/:jobId/stream', (req, res) => {
    const job = encodeJobs.get(req.params.jobId);
    if (!job || job.status.status !== 'completed') {
      res.status(404).json({ error: 'Video hasil belum tersedia.' });
      return;
    }
    streamFileWithRange(req, res, job.outputPath);
  });

  app.get('/api/outputs/:jobId/download', (req, res) => {
    const job = encodeJobs.get(req.params.jobId);
    if (!job || job.status.status !== 'completed' || !job.status.output) {
      res.status(404).json({ error: 'Video hasil belum tersedia.' });
      return;
    }
    streamFileWithRange(req, res, job.outputPath, job.status.output.fileName);
  });

  // Helper: Promise-based FFmpeg encode for Bot REST API & WhatsApp Cloud API Webhook
  const encodeVideoSync = (
    inputPath: string,
    outputPath: string,
    probe: VideoProbeInfo,
    settings: EncodeSettings
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const attempt = (allowHdr: boolean) => {
        const { args } = buildFfmpegArgs(
          inputPath,
          outputPath,
          probe,
          settings,
          allowHdr && probe.isHdr && settings.normalizeHdr
        );
        const proc = spawn('ffmpeg', args);
        let stderr = '';
        proc.stderr.on('data', (c: Buffer) => {
          stderr = (stderr + c.toString()).slice(-1000);
        });
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else if (allowHdr && probe.isHdr && settings.normalizeHdr) {
            attempt(false);
          } else {
            reject(new Error(`FFmpeg gagal (${code}): ${stderr}`));
          }
        });
      };
      attempt(true);
    });
  };

  // Bot integration status (reads env presence only, never exposes secrets)
  app.get('/api/bot/status', (_req, res) => {
    const cloudApiConfigured = Boolean(
      process.env.WA_ACCESS_TOKEN && process.env.WA_PHONE_NUMBER_ID
    );
    res.json({
      cloudApiConfigured,
      verifyTokenConfigured: Boolean(process.env.WA_VERIFY_TOKEN),
      webhookPath: '/api/wa/webhook',
      botProcessPath: '/api/bot/process',
      botScriptPath: '/api/bot/script',
    });
  });

  // Synchronous Bot API: accepts multipart video + optional resolution/aspectMode
  // Used by Baileys / WWebJS / n8n bots and the in-app WA Bot Simulator
  app.post('/api/bot/process', upload.single('video'), async (req, res) => {
    let inputPath = req.file?.path;
    try {
      const body = req.body as {
        fileId?: string;
        resolution?: string;
        aspectMode?: string;
        format?: string;
      };

      let probe: VideoProbeInfo;
      const tempId = crypto.randomUUID();

      if (req.file && inputPath) {
        probe = await probeVideoFile(inputPath, tempId, req.file.originalname);
      } else if (body?.fileId) {
        const existing = uploadedFiles.get(body.fileId);
        if (!existing || !fs.existsSync(existing.filePath)) {
          res.status(404).json({ error: 'Video sumber tidak ditemukan.' });
          return;
        }
        inputPath = existing.filePath;
        probe = existing.probe;
      } else {
        res.status(400).json({ error: 'Kirim file video (field "video") atau fileId.' });
        return;
      }

      const rawRes = body?.resolution;
      const resolution =
        rawRes === '1080p' || rawRes === '720p' || rawRes === '540p' || rawRes === 'original'
          ? rawRes
          : 'auto';
      const rawAspect = body?.aspectMode;
      const aspectMode =
        rawAspect === 'fit916' || rawAspect === 'fill916' ? rawAspect : 'keep';

      const settings: EncodeSettings = {
        mode: 'auto',
        waPreset: 'strict_bypass',
        h264Profile: 'baseline',
        resolution,
        aspectMode,
        targetSizeMb: 10.5,
        useTargetSizeCap: true,
        crf: 22,
        fps: 'auto',
        sharpen: true,
        normalizeHdr: true,
        trimStart: 0,
        trimEnd: probe.duration,
      };

      const jobId = crypto.randomUUID();
      const outputPath = path.join(OUTPUTS_DIR, `${jobId}.mp4`);
      await encodeVideoSync(inputPath, outputPath, probe, settings);

      const outProbe = await probeVideoFile(outputPath, tempId, `${jobId}.mp4`);
      const recommendation = computeEncodingPlan(probe, settings);
      const origBaseName = probe.fileName.replace(/\.[^.]+$/, '');
      const downloadName = `${origBaseName}_WA_${recommendation.resolvedResolution}.mp4`;
      const savingsPercent =
        probe.fileSize > 0
          ? Number((((probe.fileSize - outProbe.fileSize) / probe.fileSize) * 100).toFixed(1))
          : 0;

      // Save in encodeJobs so stream/download URLs work
      encodeJobs.set(jobId, {
        outputPath,
        createdAt: Date.now(),
        status: {
          jobId,
          fileId: probe.fileId,
          status: 'completed',
          progress: 100,
          fps: outProbe.fps,
          speed: '1x',
          startedAt: Date.now(),
          completedAt: Date.now(),
          settingsUsed: settings,
          recommendation,
          output: {
            fileName: downloadName,
            fileSize: outProbe.fileSize,
            duration: outProbe.duration,
            width: outProbe.width,
            height: outProbe.height,
            codec: outProbe.codec,
            pixFmt: outProbe.pixFmt,
            fps: outProbe.fps,
            videoBitrateKbps: outProbe.videoBitrateKbps,
            totalBitrateKbps: outProbe.totalBitrateKbps,
            savingsPercent,
            downloadUrl: `/api/outputs/${jobId}/download`,
            streamUrl: `/api/outputs/${jobId}/stream`,
          },
        },
      });

      const responseFormat = req.query.format || body?.format;
      if (responseFormat === 'json') {
        res.json({
          jobId,
          original: {
            fileSize: probe.fileSize,
            width: probe.width,
            height: probe.height,
            videoBitrateKbps: probe.videoBitrateKbps,
            codec: probe.codec,
          },
          output: encodeJobs.get(jobId)?.status.output,
          recommendation,
        });
      } else {
        streamFileWithRange(req, res, outputPath, downloadName);
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal memproses video untuk bot.',
      });
    } finally {
      // Clean up temporary upload if it wasn't registered in uploadedFiles
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.rmSync(req.file.path, { force: true });
      }
    }
  });

  // Downloadable ready-to-run Baileys WhatsApp Web Bot script
  app.get('/api/bot/script', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
    const apiBase = process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
      ? process.env.APP_URL.replace(/\/$/, '')
      : `${protocol}://${host}`;

    const scriptContent = `/**
 * StatusOptic WhatsApp Bot (Baileys - WhatsApp Web)
 * Cara pakai:
 * 1. npm init -y && npm install @whiskeysockets/baileys qrcode-terminal
 * 2. Jalankan: node wa-status-bot.mjs
 * 3. Scan QR dengan WhatsApp Anda, lalu kirim video ke nomor bot!
 *    Tambahkan caption "1080p", "720p", atau "540p" (opsional, default otomatis).
 * 4. Setelah bot membalas video hasil optimasi, tekan TERUSKAN (Forward) -> Status Saya!
 */
import makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

const API_ENDPOINT = '${apiBase}/api/bot/process';

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./wa_auth_session');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('Scan QR WhatsApp di bawah ini:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('StatusOptic WA Bot aktif dan siap menerima video!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const videoMsg =
      msg.message.videoMessage ||
      msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
    if (!videoMsg) return;

    const jid = msg.key.remoteJid;
    const caption = (videoMsg.caption || '').toLowerCase();
    const resolution = caption.includes('1080')
      ? '1080p'
      : caption.includes('540')
        ? '540p'
        : caption.includes('720')
          ? '720p'
          : 'auto';

    try {
      await sock.sendMessage(jid, {
        text: 'Video diterima. Sedang dioptimalkan agar tajam di Story WA...',
      });

      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const form = new FormData();
      form.append('video', new Blob([buffer], { type: 'video/mp4' }), 'input.mp4');
      form.append('resolution', resolution);

      const response = await fetch(API_ENDPOINT, { method: 'POST', body: form });
      if (!response.ok) throw new Error('Encode API gagal: ' + response.status);

      const outBuffer = Buffer.from(await response.arrayBuffer());
      const outMb = (outBuffer.length / (1024 * 1024)).toFixed(2);

      await sock.sendMessage(
        jid,
        {
          video: outBuffer,
          mimetype: 'video/mp4',
          caption: \`Siap Story WA (\${outMb} MB · \${resolution.toUpperCase()}).\\nTekan dan tahan video ini -> Teruskan (Forward) -> Status Saya agar tidak buram.\`,
        },
        { quoted: msg }
      );
    } catch (err) {
      console.error('Error:', err);
      await sock.sendMessage(jid, {
        text: 'Maaf, gagal memproses video. Pastikan format video valid dan durasi wajar.',
      });
    }
  });
}

startBot();
`;

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="wa-status-bot.mjs"');
    res.send(scriptContent);
  });

  // Meta WhatsApp Cloud API Webhook Verification
  app.get('/api/wa/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expectedToken = process.env.WA_VERIFY_TOKEN || 'statusoptic_verify_token';

    if (mode === 'subscribe' && token === expectedToken) {
      res.status(200).send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  // Meta WhatsApp Cloud API Incoming Video Handler
  app.post('/api/wa/webhook', (req, res) => {
    res.sendStatus(200);

    const accessToken = process.env.WA_ACCESS_TOKEN;
    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) return;

    const payload = req.body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              from?: string;
              type?: string;
              video?: { id?: string; caption?: string };
            }>;
          };
        }>;
      }>;
    };

    const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'video' || !message.video?.id || !message.from) {
      return;
    }

    const sender = message.from;
    const mediaId = message.video.id;
    const caption = (message.video.caption || '').toLowerCase();

    void (async () => {
      const tempIn = path.join(UPLOADS_DIR, `wa_${crypto.randomUUID()}.mp4`);
      const tempOut = path.join(OUTPUTS_DIR, `wa_out_${crypto.randomUUID()}.mp4`);
      try {
        // 1. Get Media URL from Meta Graph API
        const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const metaData = (await metaRes.json()) as { url?: string };
        if (!metaData.url) return;

        // 2. Download video binary
        const binRes = await fetch(metaData.url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const arrayBuf = await binRes.arrayBuffer();
        fs.writeFileSync(tempIn, Buffer.from(arrayBuf));

        // 3. Probe & Auto-encode with WA anti-blur preset
        const probe = await probeVideoFile(tempIn, mediaId, 'whatsapp_input.mp4');
        const resolution = caption.includes('1080')
          ? '1080p'
          : caption.includes('540')
            ? '540p'
            : caption.includes('720')
              ? '720p'
              : 'auto';

        const settings: EncodeSettings = {
          mode: 'auto',
          waPreset: 'strict_bypass',
          h264Profile: 'baseline',
          resolution,
          aspectMode: 'keep',
          targetSizeMb: 10.5,
          useTargetSizeCap: true,
          crf: 22,
          fps: 'auto',
          sharpen: true,
          normalizeHdr: true,
          trimStart: 0,
          trimEnd: probe.duration,
        };

        await encodeVideoSync(tempIn, tempOut, probe, settings);
        const outStat = fs.statSync(tempOut);

        // 4. Upload optimized MP4 back to Meta Media API
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append(
          'file',
          new Blob([fs.readFileSync(tempOut)], { type: 'video/mp4' }),
          'status_optimized.mp4'
        );

        const uploadRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/media`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form,
          }
        );
        const uploadedMedia = (await uploadRes.json()) as { id?: string };
        if (!uploadedMedia.id) return;

        // 5. Reply video to user so they can Forward to Story
        const outMb = (outStat.size / (1024 * 1024)).toFixed(2);
        await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: sender,
            type: 'video',
            video: {
              id: uploadedMedia.id,
              caption: `Siap Story WA (${outMb} MB). Teruskan (Forward) video ini langsung ke Status Saya agar tetap tajam.`,
            },
          }),
        });
      } catch (err) {
        console.error('WA Cloud API webhook error:', err);
      } finally {
        fs.rmSync(tempIn, { force: true });
        fs.rmSync(tempOut, { force: true });
      }
    })();
  });

  // Multer error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Ukuran file maksimal adalah 350 MB.' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  });

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StatusOptic server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
