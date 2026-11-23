export function buildBaileysBotScript(apiBase?: string): string {
  const cleanApi =
    apiBase && !apiBase.includes('vercel.app') ? `${apiBase.replace(/\/$/, '')}/api/bot/process` : '';

  return `/**
 * StatusOptic WhatsApp Bot (Standalone Baileys + FFmpeg — Resep PureHD 1080p Tanpa Watermark)
 *
 * Cara Menjalankan di Laptop / PC / VPS / Termux:
 * 1. Pastikan Node.js v18+ sudah terpasang (cek dengan: node -v)
 * 2. Buat folder baru, taruh file wa-status-bot.mjs ini di dalamnya, lalu buka terminal di folder tersebut.
 * 3. Jalankan perintah instalasi:
 *    npm init -y && npm install @whiskeysockets/baileys qrcode-terminal ffmpeg-static
 *    (Khusus Node v24+/Windows jika ffmpeg-static terblokir allowScripts, jalankan: node node_modules/ffmpeg-static/install.js)
 * 4. Jalankan bot:
 *    node wa-status-bot.mjs
 * 5. Scan QR Code yang muncul di terminal menggunakan WhatsApp (Perangkat Tertaut / Linked Devices).
 * 6. Kirim video sebagai Dokumen / File (disarankan) ke nomor bot:
 *    - Tanpa caption / "hd" / "1080p" -> PureHD 1080p (High@L4.0, CRF 20, max 3.8 Mbps, AAC 128k, 29.97fps)
 *    - Caption "720p"                 -> Tajam 720p (High@L3.1, CRF 20, max 2.0 Mbps, cocok klip panjang)
 *    - Caption "540p"                 -> Hemat 540p (High@L3.1, CRF 21, max 1.2 Mbps)
 * 7. Setelah bot membalas video, tekan & tahan video balasan -> Teruskan (Forward) -> Status Saya!
 */

import * as Baileys from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const makeWASocket =
  Baileys.makeWASocket || Baileys.default?.makeWASocket || Baileys.default;
const {
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestBaileysVersion,
  normalizeMessageContent,
  getContentType,
} = Baileys;

const REMOTE_API_ENDPOINT = '${cleanApi}';

// Minimal silent logger agar terminal bersih saat menampilkan QR Code
const silentLogger = {
  level: 'silent',
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return this;
  },
};

function resolveFfmpegBin() {
  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    return ffmpegPath;
  }
  return 'ffmpeg';
}

// Baca durasi, dimensi, & FPS dari header FFmpeg stderr
function probeInputQuick(bin, filePath) {
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-hide_banner', '-i', filePath]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', () => resolve({ duration: 25, fps: 30, width: 1080, height: 1920 }));
    proc.on('close', () => {
      let duration = 25;
      const durMatch = stderr.match(/Duration:\\s*(\\d+):(\\d+):(\\d+(?:\\.\\d+)?)/);
      if (durMatch) {
        const hrs = Number(durMatch[1]) || 0;
        const mins = Number(durMatch[2]) || 0;
        const secs = Number(durMatch[3]) || 0;
        const total = hrs * 3600 + mins * 60 + secs;
        if (total > 0.5) duration = total;
      }

      let fps = 30;
      const fpsMatch = stderr.match(/(\\d+(?:\\.\\d+)?)\\s*(?:fps|tbr)/);
      if (fpsMatch) {
        const parsed = Number(fpsMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) fps = parsed;
      }

      let width = 1080;
      let height = 1920;
      const dimMatch = stderr.match(/Video:[^\\n]*?(\\d{3,4})x(\\d{3,4})/);
      if (dimMatch) {
        width = Number(dimMatch[1]) || 1080;
        height = Number(dimMatch[2]) || 1920;
      }

      resolve({ duration, fps, width, height });
    });
  });
}

// Generate jpegThumbnail lewat ffmpeg-static agar Baileys mengirim protobuf videoMessage lengkap
// meski sistem Windows tidak memiliki ffmpeg global di PATH
function extractThumbnailBuffer(bin, videoFile) {
  return new Promise((resolve) => {
    const proc = spawn(bin, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '0.5',
      '-i',
      videoFile,
      '-vframes',
      '1',
      '-vf',
      'scale=320:-2',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1',
    ]);
    const chunks = [];
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.on('error', () => resolve(undefined));
    proc.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        resolve(undefined);
      }
    });
  });
}

async function encodeLocalFfmpeg(inputBuffer, resolution) {
  const bin = resolveFfmpegBin();
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inFile = path.join(tmpDir, \`wa_in_\${id}.mp4\`);
  const outFile = path.join(tmpDir, \`wa_out_\${id}.mp4\`);

  fs.writeFileSync(inFile, inputBuffer);

  try {
    const { duration, fps } = await probeInputQuick(bin, inFile);

    const is540 = resolution === '540p';
    const is720 = resolution === '720p';
    const shortCap = is540 ? 540 : is720 ? 720 : 1080;
    const longCap = is540 ? 960 : is720 ? 1280 : 1920;

    // Resep teruji PureHD 1080p:
    // High@L4.0, CRF 20, maxrate 3800k, bufsize 5700k (1.5x), 29.97fps, clean metadata (-map_metadata -1), AAC 128k 44.1kHz
    const audioKbps = is540 ? 96 : 128;
    const ceilingKbps = is540 ? 1200 : is720 ? 2000 : 3800;
    const maxCapMb = 14.5;
    const maxTotalKbpsFromCap = Math.floor(((maxCapMb * 1024 * 8) / Math.max(1, duration)) * 0.94);
    const maxVideoKbps = Math.max(550, Math.min(ceilingKbps, maxTotalKbpsFromCap - audioKbps));
    const bufsizeKbps = Math.round(maxVideoKbps * 1.5);

    const crf = is540 ? '21' : '20';
    const profile = 'high';
    const level = is540 || is720 ? '3.1' : '4.0';

    const sharpenFilter = is540 || is720 ? 'unsharp=3:3:0.3:3:3:0.0,' : '';
    const scaleFilter =
      \`scale='if(lte(iw,ih),min(\${shortCap},iw),min(\${longCap},iw))':'if(lte(iw,ih),min(\${longCap},ih),min(\${shortCap},ih))':force_original_aspect_ratio=decrease:flags=lanczos,\` +
      \`scale=trunc(iw/2)*2:trunc(ih/2)*2,\${sharpenFilter}format=yuv420p\`;

    const args = [
      '-y',
      '-i',
      inFile,
      '-map_metadata',
      '-1',
      '-vf',
      scaleFilter,
      '-c:v',
      'libx264',
      '-profile:v',
      profile,
      '-level',
      level,
      '-preset',
      'medium',
      '-crf',
      crf,
      '-maxrate',
      \`\${maxVideoKbps}k\`,
      '-bufsize',
      \`\${bufsizeKbps}k\`,
    ];

    // Samakan frame rate standar broadcast WA (29.97fps / 2997/100) jika sumber >= 30fps
    if (fps > 29.98) {
      args.push('-r', '29.97', '-vsync', 'cfr');
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
      \`\${audioKbps}k\`,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      outFile
    );

    await new Promise((resolve, reject) => {
      const proc = spawn(bin, args);
      let errLog = '';
      proc.stderr.on('data', (chunk) => {
        errLog = (errLog + chunk.toString()).slice(-800);
      });
      proc.on('error', (err) => {
        reject(
          new Error(
            'FFmpeg belum siap (' +
              err.message +
              '). Jalankan: node node_modules/ffmpeg-static/install.js'
          )
        );
      });
      proc.on('close', (code) => {
        if (code !== 0 || !fs.existsSync(outFile)) {
          reject(new Error('FFmpeg error: ' + errLog));
          return;
        }
        resolve();
      });
    });

    const outMeta = await probeInputQuick(bin, outFile);
    const jpegThumbnail = await extractThumbnailBuffer(bin, outFile);
    const buffer = fs.readFileSync(outFile);

    return {
      buffer,
      width: outMeta.width,
      height: outMeta.height,
      seconds: Math.max(1, Math.round(outMeta.duration)),
      jpegThumbnail,
    };
  } finally {
    fs.rmSync(inFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}

async function processVideo(inputBuffer, resolution) {
  try {
    return await encodeLocalFfmpeg(inputBuffer, resolution);
  } catch (localErr) {
    if (!REMOTE_API_ENDPOINT) throw localErr;
    const form = new FormData();
    form.append('video', new Blob([inputBuffer], { type: 'video/mp4' }), 'input.mp4');
    form.append('resolution', resolution);
    const response = await fetch(REMOTE_API_ENDPOINT, { method: 'POST', body: form });
    if (!response.ok) throw new Error('Encode API gagal: ' + response.status);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      width: undefined,
      height: undefined,
      seconds: undefined,
      jpegThumbnail: undefined,
    };
  }
}

async function startBot() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    console.warn(
      'Peringatan: Binary ffmpeg-static belum ditemukan. Jika belum ada ffmpeg global, jalankan: node node_modules/ffmpeg-static/install.js'
    );
  }

  const { state, saveCreds } = await useMultiFileAuthState('./wa_auth_session');
  const versionInfo =
    typeof fetchLatestBaileysVersion === 'function'
      ? await fetchLatestBaileysVersion().catch(() => undefined)
      : undefined;

  const sock = makeWASocket({
    auth: state,
    logger: silentLogger,
    ...(versionInfo?.version ? { version: versionInfo.version } : {}),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.clear();
      console.log('Scan QR WhatsApp di bawah ini (WhatsApp -> Perangkat Tertaut):\\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus (code:', statusCode, '). Reconnect:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('StatusOptic WA Bot AKTIF (PureHD 1080p)! Kirim video atau ketik "menu" ke nomor bot.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      const rawJid = msg?.key?.remoteJid;
      if (!msg?.message || !rawJid || rawJid === 'status@broadcast') continue;

      // Baileys v7 LID compatibility: gunakan @s.whatsapp.net jika tersedia di remoteJidAlt
      const jid =
        rawJid.endsWith('@lid') && msg.key.remoteJidAlt?.endsWith('@s.whatsapp.net')
          ? msg.key.remoteJidAlt
          : rawJid;

      // Unwrap ephemeralMessage / viewOnceMessage / documentWithCaptionMessage
      const normalized =
        typeof normalizeMessageContent === 'function'
          ? normalizeMessageContent(msg.message)
          : msg.message;
      if (!normalized) continue;

      const contentType =
        typeof getContentType === 'function'
          ? getContentType(normalized)
          : Object.keys(normalized)[0];

      const textBody = (
        normalized.conversation ||
        normalized.extendedTextMessage?.text ||
        ''
      )
        .trim()
        .toLowerCase();

      console.log(
        \`[PESAN] dari=\${jid} | fromMe=\${Boolean(msg.key.fromMe)} | tipe=\${contentType}\${textBody ? ' | teks=' + textBody : ''}\`
      );

      if (
        textBody === '!menu' ||
        textBody === 'menu' ||
        textBody === '!bot' ||
        textBody === 'help' ||
        textBody === 'halo' ||
        textBody === 'p'
      ) {
        await sock.sendMessage(
          jid,
          {
            text:
              '*StatusOptic Bot — Mode PureHD 1080p (Tanpa Watermark)*\\n\\n' +
              '1. Kirim video sebagai *Dokumen / File* (wajib disarankan agar bitrate asli tidak terkompres sebelum masuk bot).\\n' +
              '2. Tambah caption (opsional):\\n' +
              '   • Tanpa caption / *hd* / *1080p* -> *PureHD 1080p* (High@L4.0 · CRF 20 · ~3.8 Mbps · 29.97fps)\\n' +
              '   • *720p* -> *Tajam 720p* (High@L3.1 · ~2.0 Mbps, cocok klip panjang >35 detik)\\n' +
              '   • *540p* -> *Hemat 540p* (~1.2 Mbps)\\n' +
              '3. Bot mengirim video *tanpa caption* agar bersih. Klik ikon *Teruskan (Forward)* langsung di samping video -> *Status Saya*.',
          },
          { quoted: msg }
        );
        continue;
      }

      const directVideo = normalized.videoMessage;
      const quotedRaw = normalized.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedNorm =
        quotedRaw && typeof normalizeMessageContent === 'function'
          ? normalizeMessageContent(quotedRaw)
          : quotedRaw;
      const quotedVideo = quotedNorm?.videoMessage;

      const directDoc = normalized.documentMessage;
      const quotedDoc = quotedNorm?.documentMessage;

      const isDocVideo = (doc) => {
        if (!doc) return false;
        const mime = (doc.mimetype || '').toLowerCase();
        const name = (doc.fileName || '').toLowerCase();
        return mime.startsWith('video/') || /\\.(mp4|mov|mkv|webm|avi|m4v)$/.test(name);
      };

      const targetVideo = directVideo || quotedVideo;
      const targetDoc = isDocVideo(directDoc)
        ? directDoc
        : isDocVideo(quotedDoc)
          ? quotedDoc
          : null;

      if (!targetVideo && !targetDoc) continue;

      const captionRaw =
        targetVideo?.caption ||
        targetDoc?.caption ||
        normalized.extendedTextMessage?.text ||
        '';
      const caption = captionRaw.toLowerCase();

      if (captionRaw.startsWith('Siap Story WA')) continue;

      const isTriggerKeyword =
        caption.includes('hd') ||
        caption.includes('story') ||
        caption.includes('720') ||
        caption.includes('1080') ||
        caption.includes('540') ||
        caption.includes('kompres');
      if (msg.key.fromMe && !isTriggerKeyword) continue;

      const resolution = caption.includes('540')
        ? '540p'
        : caption.includes('720')
          ? '720p'
          : '1080p';

      try {
        console.log(\`[PROSES] Meng-encode \${targetDoc ? 'Dokumen' : 'Video'} -> PureHD \${resolution}...\`);
        await sock.sendMessage(jid, {
          text: \`\${targetDoc ? 'File video (Dokumen)' : 'Video'} diterima. Sedang meng-encode ke profil *\${resolution}* (High@L4.0 · CRF 20 · Anti-Blur WA)...\`,
        });

        const downloadTarget =
          directVideo || directDoc
            ? { key: msg.key, message: normalized }
            : {
                key: msg.key,
                message: targetVideo
                  ? { videoMessage: targetVideo }
                  : { documentMessage: targetDoc },
              };

        const buffer = await downloadMediaMessage(downloadTarget, 'buffer', {});
        const result = await processVideo(buffer, resolution);
        const outMb = (result.buffer.length / (1024 * 1024)).toFixed(2);

        await sock.sendMessage(
          jid,
          {
            video: result.buffer,
            mimetype: 'video/mp4',
            ...(result.width ? { width: result.width } : {}),
            ...(result.height ? { height: result.height } : {}),
            ...(result.seconds ? { seconds: result.seconds } : {}),
            ...(result.jpegThumbnail ? { jpegThumbnail: result.jpegThumbnail } : {}),
            gifPlayback: false,
          },
          { quoted: msg }
        );

        await sock.sendMessage(jid, {
          text: \`Siap Story WA (\${outMb} MB · \${resolution} PureHD).\\nKlik ikon *Teruskan (Forward)* di samping video di atas -> *Status Saya*.\`,
        });
        console.log(\`[SELESAI] Terkirim ke \${jid} (\${outMb} MB, \${result.width}x\${result.height}, \${result.seconds}s)\`);
      } catch (err) {
        console.error('[ERROR] Gagal memproses video:', err);
        await sock.sendMessage(jid, {
          text: 'Maaf, gagal memproses video. Pastikan binary FFmpeg sudah terpasang (node node_modules/ffmpeg-static/install.js).',
        });
      }
    }
  });
}

startBot();
`;
}
