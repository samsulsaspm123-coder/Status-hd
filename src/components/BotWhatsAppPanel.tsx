import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileCode2,
  Loader2,
  Send,
  Share2,
  Smartphone,
  Upload,
} from 'lucide-react';
import type { EncodeSettings, ResolutionOption, VideoProbeInfo } from '../types/encoder.ts';
import { buildBaileysBotScript } from '../utils/botScriptTemplate.ts';
import { encodeVideoInBrowser, generateSampleInBrowser, probeVideoInBrowser } from '../utils/browserEncoder.ts';
import { formatBytes } from '../utils/waCompressionMath.ts';

interface BotStatusResponse {
  cloudApiConfigured: boolean;
  verifyTokenConfigured: boolean;
  webhookPath: string;
  botProcessPath: string;
  botScriptPath: string;
}

interface BotSimResult {
  jobId: string;
  original: {
    fileSize: number;
    width: number;
    height: number;
    videoBitrateKbps: number;
    codec: string;
  };
  output: {
    fileName: string;
    fileSize: number;
    width: number;
    height: number;
    videoBitrateKbps: number;
    savingsPercent: number;
    downloadUrl: string;
    streamUrl: string;
  };
}

interface BotWhatsAppPanelProps {
  backendAvailable: boolean;
  currentFileId: string | null;
  currentFileName: string | null;
  currentLocalFile: File | null;
  currentProbe: VideoProbeInfo | null;
  onEnsureSample: () => Promise<string | null>;
}

export function BotWhatsAppPanel({
  backendAvailable,
  currentFileId,
  currentFileName,
  currentLocalFile,
  currentProbe,
  onEnsureSample,
}: BotWhatsAppPanelProps) {
  const [botStatus, setBotStatus] = useState<BotStatusResponse | null>(null);
  const [simResolution, setSimResolution] = useState<Exclude<ResolutionOption, 'original'>>('auto');
  const [simRunning, setSimRunning] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<BotSimResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const simFileInputRef = useRef<HTMLInputElement | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (!backendAvailable) return;
    fetch('/api/bot/status')
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null))
      .then((data: BotStatusResponse | null) => {
        if (data) setBotStatus(data);
      })
      .catch(() => {});
  }, [backendAvailable]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failures in restricted iframes
    }
  };

  const handleDownloadBotScript = () => {
    const script = buildBaileysBotScript(backendAvailable ? origin : undefined);
    const blob = new Blob([script], { type: 'application/javascript; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wa-status-bot.mjs';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const runBotSimulation = async (file?: File) => {
    setSimError(null);
    setSimRunning(true);
    setShareNote(null);

    try {
      if (!backendAvailable) {
        // Static/Vercel mode: run FFmpeg WASM directly in the browser
        let targetFile = file || currentLocalFile;
        let targetProbe = file ? (await probeVideoInBrowser(file)).probe : currentProbe;

        if (!targetFile || !targetProbe) {
          const sample = await generateSampleInBrowser();
          targetFile = sample.file;
          targetProbe = sample.probe;
        }

        const settings: EncodeSettings = {
          mode: 'auto',
          waPreset: 'strict_bypass',
          h264Profile: 'baseline',
          resolution: simResolution,
          aspectMode: 'keep',
          targetSizeMb: 10.5,
          useTargetSizeCap: true,
          crf: 22,
          fps: 'auto',
          sharpen: true,
          normalizeHdr: true,
          trimStart: 0,
          trimEnd: targetProbe.duration,
        };

        const job = await encodeVideoInBrowser(targetFile, targetProbe, settings, () => {});
        if (!job.output) throw new Error('Gagal memproses video di browser.');

        setSimResult({
          jobId: job.jobId,
          original: {
            fileSize: targetProbe.fileSize,
            width: targetProbe.width,
            height: targetProbe.height,
            videoBitrateKbps: targetProbe.videoBitrateKbps,
            codec: targetProbe.codec,
          },
          output: {
            fileName: job.output.fileName,
            fileSize: job.output.fileSize,
            width: job.output.width,
            height: job.output.height,
            videoBitrateKbps: job.output.videoBitrateKbps,
            savingsPercent: job.output.savingsPercent,
            downloadUrl: job.output.downloadUrl,
            streamUrl: job.output.streamUrl,
          },
        });
        return;
      }

      const formData = new FormData();
      formData.append('resolution', simResolution);
      formData.append('format', 'json');

      if (file) {
        formData.append('video', file);
      } else {
        const targetId = currentFileId || (await onEnsureSample());
        if (!targetId) {
          throw new Error('Gagal menyiapkan video untuk simulasi bot.');
        }
        formData.append('fileId', targetId);
      }

      const res = await fetch('/api/bot/process?format=json', {
        method: 'POST',
        body: formData,
      });
      const data = (await res.json()) as BotSimResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Bot gagal memproses video.');
      }
      setSimResult(data);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Terjadi kesalahan pada simulasi bot.');
    } finally {
      setSimRunning(false);
    }
  };

  const handleNativeShare = async () => {
    if (!simResult) return;
    setShareNote(null);

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const resp = await fetch(simResult.output.downloadUrl);
        const blob = await resp.blob();
        const file = new File([blob], simResult.output.fileName, { type: 'video/mp4' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Video Siap Story WA',
            text: 'Siap diteruskan ke Status WhatsApp tanpa buram.',
          });
          return;
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    setShareNote(
      'Browser desktop tidak mendukung Share Sheet langsung ke WA. Gunakan tombol Unduh MP4 lalu kirim via WhatsApp Web atau HP.'
    );
  };

  const curlExample = `curl -X POST "${origin}/api/bot/process?format=json" \\
  -F "video=@video_kamera.mp4" \\
  -F "resolution=720p"`;

  return (
    <div className="space-y-10">
      {/* Top 2-Column Interactive Simulator & Architecture */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Interactive WA Bot Chat Simulator */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Simulasi Alur Bot WhatsApp
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Uji langsung cara bot menerima video, meng-encode dengan FFmpeg, dan membalas MP4 siap teruskan ke Story.
              </p>
            </div>
          </div>

          {/* Chat Canvas */}
          <div className="bg-slate-100 p-4 sm:p-5 space-y-4 min-h-[360px]">
            {/* User Outgoing Message */}
            <div className="flex justify-end">
              <div className="max-w-[85%] bg-emerald-700 text-white rounded-xl rounded-tr-xs p-3.5 space-y-2 shadow-xs">
                <div className="text-xs text-emerald-100 font-medium">
                  Anda mengirim video ke Bot
                </div>
                <div className="text-xs font-mono bg-emerald-800/70 rounded-lg px-2.5 py-2 truncate">
                  {currentFileName || 'Kamera_Story_1080p_60fps_HighBitrate.mp4'}
                </div>
                <div className="flex items-center justify-between text-[11px] text-emerald-100">
                  <span>
                    Perintah caption: <strong className="text-white">{simResolution}</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Bot Processing / Reply */}
            {simRunning && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-white border border-slate-200 text-slate-800 rounded-xl rounded-tl-xs p-3.5 flex items-center gap-2.5 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600 shrink-0" />
                  <span>Bot sedang meng-encode video agar tahan kompresi WA...</span>
                </div>
              </div>
            )}

            {simError && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-red-50 border border-red-200 text-red-800 rounded-xl rounded-tl-xs p-3.5 text-xs">
                  {simError}
                </div>
              </div>
            )}

            {simResult && !simRunning && (
              <div className="flex justify-start">
                <div className="max-w-[90%] w-full sm:w-[340px] bg-white border border-slate-200 rounded-xl rounded-tl-xs overflow-hidden shadow-xs">
                  <div className="bg-black aspect-[9/16] max-h-[280px] flex items-center justify-center">
                    <video
                      src={simResult.output.streamUrl}
                      controls
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="p-3.5 space-y-2.5">
                    <div className="text-xs text-slate-800 leading-relaxed">
                      <strong>Siap Story WA</strong> ·{' '}
                      <span className="font-mono tabular-nums">
                        {simResult.output.width}×{simResult.output.height}
                      </span>{' '}
                      ·{' '}
                      <span className="font-mono tabular-nums font-semibold text-emerald-700">
                        {formatBytes(simResult.output.fileSize)}
                      </span>{' '}
                      (hemat {simResult.output.savingsPercent}% dari{' '}
                      {formatBytes(simResult.original.fileSize)})
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Di WhatsApp asli, cukup tekan &amp; tahan video balasan ini lalu pilih{' '}
                      <strong className="text-slate-700">Teruskan (Forward) → Status Saya</strong>.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <a
                        href={simResult.output.downloadUrl}
                        download={simResult.output.fileName}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Unduh MP4
                      </a>
                      <button
                        type="button"
                        onClick={handleNativeShare}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        Bagikan ke WA
                      </button>
                    </div>
                    {shareNote && <p className="text-[11px] text-amber-700">{shareNote}</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Chat Input Bar */}
          <div className="p-4 border-t border-slate-200 bg-white space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Pilih Caption Resolusi:</span>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['auto', '1080p', '720p', '540p'] as const).map((resOpt) => (
                  <button
                    key={resOpt}
                    type="button"
                    disabled={simRunning}
                    onClick={() => setSimResolution(resOpt)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      simResolution === resOpt
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {resOpt === 'auto' ? 'Otomatis' : resOpt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={simFileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void runBotSimulation(file);
                  e.target.value = '';
                }}
              />

              <button
                type="button"
                disabled={simRunning}
                onClick={() => void runBotSimulation()}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                {currentFileId ? 'Kirim Video Aktif ke Bot' : 'Uji Bot dengan Video Sampel'}
              </button>

              <button
                type="button"
                disabled={simRunning}
                onClick={() => simFileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 py-2.5 px-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Pilih File Lain
              </button>
            </div>
          </div>
        </div>

        {/* Right: Cost Breakdown, Forward Trick Explanation & Ready-to-Use Endpoints */}
        <div className="lg:col-span-6 space-y-6">
          {/* Why Forward Works */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-slate-900">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              <h3 className="font-display text-base font-bold">
                Rahasia Mengapa “Kirim ke Bot → Teruskan ke Story” Tidak Buram
              </h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Saat Anda memilih video langsung dari Galeri HP ke Story WA, aplikasi WhatsApp di HP
              memicu <em>compressor bawaan</em> yang memangkas bitrate secara agresif. Namun ketika
              bot sudah meng-encode video sesuai standar WA (H.264 8-bit, &lt;15 MB, bitrate aman)
              lalu mengirimkannya ke chat Anda, file tersebut sudah berada di server WhatsApp. Saat
              Anda menekan <strong className="text-slate-900">Teruskan (Forward) → Status Saya</strong>,
              WhatsApp meneruskan aset media yang sudah terverifikasi tanpa mengompres ulang dari awal.
            </p>
          </section>

          {/* Gratis vs Berbayar Comparison */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Biaya &amp; Sistem Membuat Bot WhatsApp Sendiri
            </h3>

            <div className="divide-y divide-slate-100 border-t border-slate-100">
              <div className="py-3.5 first:pt-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    1. Jalur Gratis: Baileys (WhatsApp Web)
                  </span>
                  <span className="text-xs font-semibold text-emerald-700">Rp 0 (Gratis)</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Menggunakan protokol WhatsApp Web (seperti library open-source{' '}
                  <span className="font-mono">Baileys</span>) — tinggal scan QR dari HP, tanpa
                  perlu kartu kredit atau pendaftaran Meta Business. Cocok untuk pemakaian pribadi
                  atau grup kecil. Biaya yang dibutuhkan hanya komputer/VPS kecil untuk menyalakan
                  bot (bisa dijalankan di laptop sendiri atau VPS ~Rp 50rb/bulan).
                </p>
                <div className="pt-1 space-y-3">
                  <button
                    type="button"
                    onClick={handleDownloadBotScript}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    Unduh Script Bot Mandiri (wa-status-bot.mjs)
                  </button>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 text-[11px] text-slate-700">
                    <div className="font-semibold text-slate-900">
                      Langkah Menjalankan di Laptop / VPS / Termux:
                    </div>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Taruh file <span className="font-mono">wa-status-bot.mjs</span> di folder baru,
                        lalu buka Terminal/CMD di folder tersebut (pastikan Node.js 18+ terpasang).
                      </li>
                      <li>
                        Install paket Baileys &amp; FFmpeg:
                        <pre className="mt-1 font-mono text-[10px] bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto">
                          npm init -y &amp;&amp; npm install @whiskeysockets/baileys qrcode-terminal ffmpeg-static
                        </pre>
                      </li>
                      <li>
                        Jalankan <span className="font-mono font-semibold">node wa-status-bot.mjs</span>{' '}
                        lalu scan QR lewat menu <strong>WhatsApp → Perangkat Tertaut</strong>.
                      </li>
                      <li>
                        Kirim video ke nomor bot (atau ke <em>Chat Diri Sendiri</em> dengan caption{' '}
                        <span className="font-mono">hd</span> / <span className="font-mono">720p</span> /{' '}
                        <span className="font-mono">1080p</span>), lalu{' '}
                        <strong>Teruskan (Forward) → Status Saya</strong>.
                      </li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="py-3.5 last:pb-0 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    2. Jalur Resmi: Meta WhatsApp Cloud API
                  </span>
                  <span className="text-xs font-semibold text-slate-700">
                    Gratis Balasan 24 Jam
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Resmi dari Meta dan anti-banned untuk publik. Di kebijakan WhatsApp Cloud API,{' '}
                  <strong className="text-slate-800">
                    pesan balasan (Service Conversation) yang dipicu karena user mengirim video
                    terlebih dahulu gratis (unlimited di jendela 24 jam)
                  </strong>
                  . Yang berbayar hanyalah jika bot Anda mengirim pesan promosi/template duluan ke
                  user. Butuh nomor khusus yang belum terdaftar di aplikasi WA biasa.
                </p>
              </div>
            </div>
          </section>

          {/* Ready-to-Use API & Webhook Endpoints */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-slate-900">
                Endpoint Server Bot Siap Pakai
              </h3>
              <span className="text-xs font-medium text-slate-500">
                {!backendAvailable
                  ? 'Mode Browser (Hosting Statis)'
                  : botStatus?.cloudApiConfigured
                    ? 'Cloud API Env Aktif'
                    : 'Mode API Terbuka · Env Cloud API Opsional'}
              </span>
            </div>

            {!backendAvailable && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                Aplikasi ini sedang berjalan di hosting statis (seperti Vercel), sehingga Encoder Web
                berjalan 100% di browser. Untuk menjalankan <strong>Bot WhatsApp 24 jam</strong> dan
                endpoint API/Webhook di bawah ini, deploy backend <span className="font-mono">server.ts</span>{' '}
                ke server Node.js dengan FFmpeg (misalnya Railway, Render, Fly.io, atau VPS).
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-slate-600">
                  <span className="font-semibold text-slate-800">
                    API Kompresi Bot (POST Multipart)
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('api', `${origin}/api/bot/process`)}
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    {copiedKey === 'api' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Disalin
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Salin URL
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 truncate">
                  {origin}/api/bot/process
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-slate-600">
                  <span className="font-semibold text-slate-800">
                    Webhook Meta WhatsApp Cloud API
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('webhook', `${origin}/api/wa/webhook`)}
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    {copiedKey === 'webhook' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Disalin
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Salin URL
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 truncate">
                  {origin}/api/wa/webhook
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-slate-600">
                  <span className="font-semibold text-slate-800">Contoh Uji cURL</span>
                  <button
                    type="button"
                    onClick={() => void copyText('curl', curlExample)}
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    {copiedKey === 'curl' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Disalin
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Salin
                      </>
                    )}
                  </button>
                </div>
                <pre className="font-mono text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto leading-relaxed">
                  {curlExample}
                </pre>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
