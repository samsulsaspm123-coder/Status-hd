import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Forward,
  Loader2,
  Send,
  Share2,
  Terminal,
  Upload,
} from 'lucide-react';
import type { ResolutionOption, VideoProbeInfo } from '../types/encoder.ts';
import { formatBytes } from '../utils/waCompressionMath.ts';

interface WhatsAppBotHubProps {
  currentProbe: VideoProbeInfo | null;
  onBotEncodeCompleted?: (item: {
    jobId: string;
    originalName: string;
    originalSize: number;
    originalResolution: string;
    outputSize: number;
    outputResolution: string;
    outputBitrateKbps: number;
    savingsPercent: number;
    downloadUrl: string;
    streamUrl: string;
    sourceStreamUrl: string;
    modeLabel: string;
  }) => void;
}

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
    duration: number;
    width: number;
    height: number;
    videoBitrateKbps: number;
    savingsPercent: number;
    downloadUrl: string;
    streamUrl: string;
  };
  recommendation: {
    resolvedResolution: string;
    reason: string;
  };
}

export function WhatsAppBotHub({ currentProbe, onBotEncodeCompleted }: WhatsAppBotHubProps) {
  const [botStatus, setBotStatus] = useState<BotStatusResponse | null>(null);
  const [captionRes, setCaptionRes] = useState<Exclude<ResolutionOption, 'original'>>('auto');
  const [isSimProcessing, setIsSimProcessing] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<BotSimResult | null>(null);
  const [simFileName, setSimFileName] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    fetch('/api/bot/status')
      .then((r) => r.json())
      .then((data: BotStatusResponse) => setBotStatus(data))
      .catch(() => {});
  }, []);

  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const runBotProcess = async (payload: { file?: File; fileId?: string; fileName: string }) => {
    setIsSimProcessing(true);
    setSimError(null);
    setSimFileName(payload.fileName);

    try {
      const form = new FormData();
      if (payload.file) {
        form.append('video', payload.file);
      } else if (payload.fileId) {
        form.append('fileId', payload.fileId);
      }
      form.append('resolution', captionRes);
      form.append('format', 'json');

      const res = await fetch('/api/bot/process?format=json', {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as BotSimResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memproses video di endpoint bot.');
      }

      setSimResult(data);
      if (onBotEncodeCompleted && data.output) {
        onBotEncodeCompleted({
          jobId: data.jobId,
          originalName: payload.fileName,
          originalSize: data.original.fileSize,
          originalResolution: `${data.original.width}×${data.original.height}`,
          outputSize: data.output.fileSize,
          outputResolution: `${data.output.width}×${data.output.height}`,
          outputBitrateKbps: data.output.videoBitrateKbps,
          savingsPercent: data.output.savingsPercent,
          downloadUrl: data.output.downloadUrl,
          streamUrl: data.output.streamUrl,
          sourceStreamUrl: payload.fileId ? `/api/files/${payload.fileId}/stream` : data.output.streamUrl,
          modeLabel: `Bot WA (${data.recommendation.resolvedResolution})`,
        });
      }
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses bot.');
    } finally {
      setIsSimProcessing(false);
    }
  };

  const handleShareToWhatsApp = async () => {
    if (!simResult?.output) return;
    setShareFeedback(null);

    try {
      const res = await fetch(simResult.output.downloadUrl);
      const blob = await res.blob();
      const file = new File([blob], simResult.output.fileName, { type: 'video/mp4' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Video Siap Story WA',
        });
        return;
      }

      // Desktop fallback: trigger download and explain next step
      const a = document.createElement('a');
      a.href = simResult.output.downloadUrl;
      a.download = simResult.output.fileName;
      a.click();
      setShareFeedback(
        'Browser desktop tidak mendukung kirim file langsung. Video sudah diunduh—unggah via WhatsApp Web atau kirim ke HP Anda.'
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setShareFeedback('Gunakan tombol Unduh MP4 di samping untuk menyimpan file.');
      }
    }
  };

  const webhookUrl = `${origin}/api/wa/webhook`;
  const processApiUrl = `${origin}/api/bot/process`;

  return (
    <div className="space-y-8">
      {/* Main 2-column Bot Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Real Bot Chat Simulator */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Simulasi Alur Bot WhatsApp (Live FFmpeg API)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Uji langsung cara bot membalas video siap-teruskan (Forward) ke Story WA
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {(['auto', '720p', '1080p', '540p'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={isSimProcessing}
                  onClick={() => setCaptionRes(r)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    captionRes === r
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {r === 'auto' ? 'Auto' : r}
                </button>
              ))}
            </div>
          </div>

          {/* Chat Thread Canvas */}
          <div className="p-5 bg-slate-100/80 space-y-4 min-h-[380px]">
            {/* System Explanation Bubble */}
            <div className="max-w-md mx-auto text-center bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-xs text-slate-600">
              Kirim video dengan caption resolusi (<span className="font-mono">auto</span>,{' '}
              <span className="font-mono">720p</span>, <span className="font-mono">1080p</span>).
              Bot membalas file MP4 teroptimasi yang aman diteruskan ke Status Saya.
            </div>

            {/* Outgoing User Video Bubble */}
            {(simFileName || currentProbe) && (
              <div className="flex justify-end">
                <div className="max-w-[85%] sm:max-w-sm bg-emerald-700 text-white rounded-xl rounded-tr-xs p-3.5 space-y-1.5 shadow-xs">
                  <div className="text-xs font-semibold">
                    Anda mengirim video
                  </div>
                  <div className="text-xs text-emerald-100 font-mono truncate">
                    {simFileName || currentProbe?.fileName}
                  </div>
                  {currentProbe && !simFileName && (
                    <div className="text-[11px] text-emerald-100 font-mono tabular-nums">
                      {currentProbe.width}×{currentProbe.height} · {formatBytes(currentProbe.fileSize)}
                    </div>
                  )}
                  <div className="text-xs pt-1 border-t border-emerald-600/60">
                    Caption: <span className="font-mono font-semibold">{captionRes}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Processing Bubble */}
            {isSimProcessing && (
              <div className="flex justify-start">
                <div className="max-w-sm bg-white border border-slate-200 rounded-xl rounded-tl-xs p-3.5 flex items-center gap-2.5 text-xs text-slate-700 shadow-xs">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600 shrink-0" />
                  <span>
                    Bot sedang menjalankan FFmpeg (H.264 High@L4.0 + faststart)...
                  </span>
                </div>
              </div>
            )}

            {/* Error Bubble */}
            {simError && (
              <div className="flex justify-start">
                <div className="max-w-sm bg-red-50 border border-red-200 rounded-xl rounded-tl-xs p-3.5 text-xs text-red-800">
                  {simError}
                </div>
              </div>
            )}

            {/* Incoming Bot Reply Video Bubble */}
            {simResult && !isSimProcessing && (
              <div className="flex justify-start">
                <div className="max-w-[90%] sm:max-w-md bg-white border border-slate-200 rounded-xl rounded-tl-xs p-3.5 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-slate-900">Bot StatusOptic</span>
                    <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                      {formatBytes(simResult.output.fileSize)}
                    </span>
                  </div>

                  <div className="rounded-lg overflow-hidden bg-black">
                    <video
                      src={simResult.output.streamUrl}
                      controls
                      playsInline
                      className="w-full max-h-[300px] object-contain"
                    />
                  </div>

                  <div className="text-xs text-slate-700 leading-relaxed space-y-1">
                    <p>
                      Siap Story WA ({simResult.output.width}×{simResult.output.height} ·{' '}
                      <span className="font-mono tabular-nums">
                        {(simResult.output.videoBitrateKbps / 1000).toFixed(2)} Mbps
                      </span>{' '}
                      · hemat {simResult.output.savingsPercent}%).
                    </p>
                    <p className="text-slate-500">
                      Di WhatsApp asli, cukup tekan tahan balasan bot ini →{' '}
                      <strong className="text-slate-800">Teruskan (Forward) → Status Saya</strong>.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleShareToWhatsApp}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Kirim / Bagikan ke WA
                    </button>
                    <a
                      href={simResult.output.downloadUrl}
                      download={simResult.output.fileName}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Unduh MP4
                    </a>
                  </div>

                  {shareFeedback && (
                    <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
                      {shareFeedback}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Composer Action Bar */}
          <div className="p-4 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void runBotProcess({ file, fileName: file.name });
                }
                e.target.value = '';
              }}
            />

            <button
              type="button"
              disabled={isSimProcessing}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              Kirim File Video Baru ke Bot
            </button>

            {currentProbe && (
              <button
                type="button"
                disabled={isSimProcessing}
                onClick={() =>
                  void runBotProcess({
                    fileId: currentProbe.fileId,
                    fileName: currentProbe.fileName,
                  })
                }
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                Proses Video Aktif via Bot ({captionRes})
              </button>
            )}
          </div>
        </div>

        {/* Right: Real WA Bot Integration & Explanation */}
        <div className="lg:col-span-5 space-y-6">
          {/* Why Forward works */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-slate-900">
              <Forward className="w-4 h-4 text-emerald-600 shrink-0" />
              <h3 className="font-display text-base font-bold">
                Rahasia Mengapa “Teruskan ke Story” Dari Bot Tidak Buram
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Saat Anda mengirim video mentah ke Bot WA, server bot meng-encode ulang video ke profil
              standar WhatsApp (<span className="font-mono">H.264 yuv420p</span>, 720p/1080p, di bawah
              14.2 MB, atom <span className="font-mono">+faststart</span>) lalu mengirimkannya balik
              ke chat Anda.
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Ketika Anda memilih <strong className="text-slate-900">Teruskan (Forward) → Status Saya</strong>,
              file tersebut sudah lolos standar media server WhatsApp, sehingga aplikasi WA di HP
              Anda langsung meneruskan aset tersebut ke Story tanpa mengompresnya ulang secara
              destruktif.
            </p>
          </section>

          {/* Option A: Personal Baileys WA Bot */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-slate-900">
                1. Jalankan Bot WhatsApp Sendiri (Scan QR)
              </h3>
              <span className="text-[11px] font-mono text-emerald-700 font-semibold">
                Baileys Node.js
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Unduh script bot yang sudah terhubung langsung ke API encoder aplikasi ini. Jalankan di
              PC/VPS Anda lalu scan QR menggunakan WhatsApp.
            </p>

            <div className="bg-slate-950 text-slate-100 rounded-lg p-3 font-mono text-[11px] space-y-1 overflow-x-auto">
              <div className="text-slate-400"># Install dependensi & jalankan bot</div>
              <div>npm install @whiskeysockets/baileys qrcode-terminal</div>
              <div>node wa-status-bot.mjs</div>
            </div>

            <a
              href="/api/bot/script"
              download="wa-status-bot.mjs"
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh Script Bot (wa-status-bot.mjs)
            </a>
          </section>

          {/* Option B: Webhook & REST API */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-slate-700" />
                <h3 className="font-display text-sm font-bold text-slate-900">
                  2. Webhook Cloud API & Endpoint REST Bot
                </h3>
              </div>
              <span
                className={`text-[11px] font-semibold ${
                  botStatus?.cloudApiConfigured ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {botStatus?.cloudApiConfigured ? 'Cloud API Aktif' : 'Siap via .env'}
              </span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <div className="text-[11px] font-semibold text-slate-600 mb-1">
                  Endpoint Proses Bot (POST multipart field: video)
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <code className="font-mono text-[11px] text-slate-800 truncate flex-1">
                    {processApiUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyText('api', processApiUrl)}
                    className="text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
                    title="Salin URL API"
                  >
                    {copiedKey === 'api' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-slate-600 mb-1">
                  Webhook Meta WhatsApp Cloud API (GET/POST)
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <code className="font-mono text-[11px] text-slate-800 truncate flex-1">
                    {webhookUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyText('webhook', webhookUrl)}
                    className="text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
                    title="Salin URL Webhook"
                  >
                    {copiedKey === 'webhook' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Untuk Meta Cloud API otomatis, atur variabel{' '}
                <span className="font-mono">WA_ACCESS_TOKEN</span>,{' '}
                <span className="font-mono">WA_PHONE_NUMBER_ID</span>, dan{' '}
                <span className="font-mono">WA_VERIFY_TOKEN</span> di environment server.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
