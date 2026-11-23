export function buildBaileysBotScript(apiBase?: string): string {
  const cleanApi =
    apiBase && !apiBase.includes('vercel.app') ? `${apiBase.replace(/\/$/, '')}/api/bot/process` : '';

  return `/**
 * StatusOptic WhatsApp Bot (Standalone Baileys + FFmpeg)
 *
 * Cara Menjalankan di Laptop / PC / VPS / Termux:
 * 1. Pastikan Node.js v18+ sudah terpasang (cek dengan: node -v)
 * 2. Buat folder baru, taruh file wa-status-bot.mjs ini di dalamnya, lalu buka terminal di folder tersebut.
 * 3. Jalankan perintah instalasi:
 *    npm init -y && npm install @whiskeysockets/baileys qrcode-terminal ffmpeg-static
 * 4. Jalankan bot:
 *    node wa-status-bot.mjs
 * 5. Scan QR Code yang muncul di terminal menggunakan WhatsApp (Perangkat Tertaut / Linked Devices).
 * 6. Kirim video ke nomor bot (atau kirim ke Chat Diri Sendiri dengan caption "hd" / "720p"):
 *    - Tanpa caption atau "720p" -> Bypass Ketat (720p, ~1.25 Mbps, Baseline@L3.1) [Paling Aman Anti-Blur]
 *    - Caption "1080p"              -> Mode HD Status (1080p, ~2.4 Mbps)
 *    - Caption "540p"               -> Mode Hemat (540p, ~850 kbps, cocok untuk klip panjang)
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

function encodeLocalFfmpeg(inputBuffer, resolution) {
  return new Promise((resolve, reject) => {
    const bin = resolveFfmpegBin();
    const tmpDir = os.tmpdir();
    const id = crypto.randomUUID();
    const inFile = path.join(tmpDir, \`wa_in_\${id}.mp4\`);
    const outFile = path.join(tmpDir, \`wa_out_\${id}.mp4\`);

    fs.writeFileSync(inFile, inputBuffer);

    const is1080 = resolution === '1080p';
    const is540 = resolution === '540p';
    const shortCap = is1080 ? 1080 : is540 ? 540 : 720;
    const longCap = is1080 ? 1920 : is540 ? 960 : 1280;
    const maxrate = is1080 ? '2400k' : is540 ? '850k' : '1250k';
    const bufsize = is1080 ? '4800k' : is540 ? '1700k' : '2500k';
    const crf = is1080 ? '20' : '22';
    const profile = is1080 ? 'main' : 'baseline';
    const level = is1080 ? '4.0' : '3.1';

    const scaleFilter =
      \`scale='if(lte(iw,ih),min(\${shortCap},iw),min(\${longCap},iw))':'if(lte(iw,ih),min(\${longCap},ih),min(\${shortCap},ih))':force_original_aspect_ratio=decrease:flags=lanczos,\` +
      \`scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,unsharp=3:3:0.35:3:3:0.0,format=yuv420p\`;

    const args = [
      '-y',
      '-i',
      inFile,
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
      maxrate,
      '-bufsize',
      bufsize,
      '-r',
      '30',
      '-vsync',
      'cfr',
      '-pix_fmt',
      'yuv420p',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      outFile,
    ];

    const proc = spawn(bin, args);
    let errLog = '';
    proc.stderr.on('data', (chunk) => {
      errLog = (errLog + chunk.toString()).slice(-800);
    });
    proc.on('error', (err) => {
      fs.rmSync(inFile, { force: true });
      fs.rmSync(outFile, { force: true });
      reject(
        new Error(
          'FFmpeg belum siap (' +
            err.message +
            '). Jalankan: node node_modules/ffmpeg-static/install.js'
        )
      );
    });

    proc.on('close', (code) => {
      try {
        if (code !== 0 || !fs.existsSync(outFile)) {
          reject(new Error('FFmpeg error: ' + errLog));
          return;
        }
        const result = fs.readFileSync(outFile);
        resolve(result);
      } finally {
        fs.rmSync(inFile, { force: true });
        fs.rmSync(outFile, { force: true });
      }
    });
  });
}

async function processVideo(inputBuffer, resolution) {
  // Prioritaskan FFmpeg lokal (lebih cepat & tidak butuh upload ke server luar)
  try {
    return await encodeLocalFfmpeg(inputBuffer, resolution);
  } catch (localErr) {
    if (!REMOTE_API_ENDPOINT) throw localErr;
    const form = new FormData();
    form.append('video', new Blob([inputBuffer], { type: 'video/mp4' }), 'input.mp4');
    form.append('resolution', resolution);
    const response = await fetch(REMOTE_API_ENDPOINT, { method: 'POST', body: form });
    if (!response.ok) throw new Error('Encode API gagal: ' + response.status);
    return Buffer.from(await response.arrayBuffer());
  }
}

async function startBot() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    console.warn(
      'Peringatan: Binary ffmpeg-static belum ditemukan. Jika belum ada ffmpeg global, jalankan: node node_modules/ffmpeg-static/install.js'
    );
  }

  const { state, saveCreds } = await useMultiFileAuthState('./wa_auth_session');
  const versionInfo = typeof fetchLatestBaileysVersion === 'function'
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
      console.log('Koneksi terputus. Reconnect:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('StatusOptic WA Bot AKTIF! Kirim video ke bot untuk dioptimalkan.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg?.message) return;

    const videoMsg =
      msg.message.videoMessage ||
      msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
    if (!videoMsg) return;

    const captionRaw = videoMsg.caption || '';
    const caption = captionRaw.toLowerCase();

    // Abaikan pesan balasan bot sendiri agar tidak looping
    if (captionRaw.startsWith('Siap Story WA')) return;

    // Jika dikirim dari nomor sendiri (Chat Diri Sendiri), wajib beri kata kunci agar tidak memproses semua chat keluar
    const isTriggerKeyword =
      caption.includes('hd') ||
      caption.includes('story') ||
      caption.includes('720') ||
      caption.includes('1080') ||
      caption.includes('540') ||
      caption.includes('kompres');
    if (msg.key.fromMe && !isTriggerKeyword) return;

    const jid = msg.key.remoteJid;
    const resolution = caption.includes('1080')
      ? '1080p'
      : caption.includes('540')
        ? '540p'
        : '720p';

    try {
      await sock.sendMessage(jid, {
        text: \`Video diterima. Sedang meng-encode ke profil \${resolution} anti-blur WA...\`,
      });

      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const outBuffer = await processVideo(buffer, resolution);
      const outMb = (outBuffer.length / (1024 * 1024)).toFixed(2);

      await sock.sendMessage(
        jid,
        {
          video: outBuffer,
          mimetype: 'video/mp4',
          caption: \`Siap Story WA (\${outMb} MB · \${resolution} Bypass WA).\\nTekan & tahan video ini -> Teruskan (Forward) -> Status Saya.\`,
        },
        { quoted: msg }
      );
    } catch (err) {
      console.error('Gagal memproses video:', err);
      await sock.sendMessage(jid, {
        text: 'Maaf, gagal memproses video. Pastikan ffmpeg-static terpasang dan durasi video wajar.',
      });
    }
  });
}

startBot();
`;
}
