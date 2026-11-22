/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileVideo,
  Film,
  Loader2,
  MessageCircle,
  Sliders,
  UploadCloud,
  X,
} from 'lucide-react';
import { BotWhatsAppPanel } from './components/BotWhatsAppPanel.tsx';
import { DiagnosticsPanel } from './components/DiagnosticsPanel.tsx';
import { EducationalSections } from './components/EducationalSections.tsx';
import { EncoderControls } from './components/EncoderControls.tsx';
import { VideoPreviewStudio } from './components/VideoPreviewStudio.tsx';
import type {
  EncodeJobStatus,
  EncodeSettings,
  SessionHistoryItem,
  VideoProbeInfo,
} from './types/encoder.ts';
import {
  encodeVideoInBrowser,
  generateSampleInBrowser,
  probeVideoInBrowser,
} from './utils/browserEncoder.ts';
import { computeEncodingPlan, formatBytes } from './utils/waCompressionMath.ts';

function buildDefaultSettings(probe: VideoProbeInfo): EncodeSettings {
  return {
    mode: 'auto',
    resolution: 'auto',
    aspectMode: 'keep',
    targetSizeMb: 14.2,
    useTargetSizeCap: true,
    crf: 21,
    fps: 'auto',
    sharpen: true,
    normalizeHdr: true,
    trimStart: 0,
    trimEnd: probe.duration,
  };
}

export default function App() {
  const [workspaceTab, setWorkspaceTab] = useState<'web' | 'bot'>('web');
  const [probe, setProbe] = useState<VideoProbeInfo | null>(null);
  const [settings, setSettings] = useState<EncodeSettings | null>(null);
  const [activeJob, setActiveJob] = useState<EncodeJobStatus | null>(null);
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);

  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingSample, setIsGeneratingSample] = useState(false);
  const [isStartingEncode, setIsStartingEncode] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [encodeError, setEncodeError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewHistoryItem, setPreviewHistoryItem] = useState<SessionHistoryItem | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean>(true);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localStreamUrl, setLocalStreamUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recordedJobsRef = useRef<Set<string>>(new Set());

  // Detect whether full-stack Express FFmpeg server is available (vs static Vercel hosting)
  useEffect(() => {
    fetch('/api/bot/status')
      .then((res) => {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        setBackendAvailable(Boolean(res.ok && isJson));
      })
      .catch(() => {
        setBackendAvailable(false);
      });
  }, []);

  // Poll job status while queued or processing
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'queued' && activeJob.status !== 'processing')) {
      return;
    }

    const interval = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/jobs/${activeJob.jobId}`);
          if (!res.ok) return;
          const updated = (await res.json()) as EncodeJobStatus;
          setActiveJob(updated);

          if (updated.status === 'error') {
            setEncodeError(updated.error || 'Terjadi kesalahan saat meng-encode video.');
          } else if (
            updated.status === 'completed' &&
            updated.output &&
            probe &&
            !recordedJobsRef.current.has(updated.jobId)
          ) {
            recordedJobsRef.current.add(updated.jobId);
            const out = updated.output;
            const modeLabel =
              updated.settingsUsed.mode === 'auto'
                ? `Otomatis (${updated.recommendation.resolvedResolution})`
                : `Manual (${updated.recommendation.resolvedResolution})`;

            setHistory((prev) => [
              {
                jobId: updated.jobId,
                createdAt: Date.now(),
                originalName: probe.fileName,
                originalSize: probe.fileSize,
                originalResolution: `${probe.width}×${probe.height}`,
                outputSize: out.fileSize,
                outputResolution: `${out.width}×${out.height}`,
                outputBitrateKbps: out.videoBitrateKbps,
                savingsPercent: out.savingsPercent,
                downloadUrl: out.downloadUrl,
                streamUrl: out.streamUrl,
                sourceStreamUrl: `/api/files/${probe.fileId}/stream`,
                modeLabel,
              },
              ...prev,
            ]);
          }
        } catch {
          // Retry on next tick
        }
      })();
    }, 450);

    return () => clearInterval(interval);
  }, [activeJob, probe]);

  const recordCompletedHistory = (
    completedJob: EncodeJobStatus,
    sourceProbe: VideoProbeInfo,
    sourceUrl: string
  ) => {
    if (!completedJob.output || recordedJobsRef.current.has(completedJob.jobId)) return;
    recordedJobsRef.current.add(completedJob.jobId);
    const out = completedJob.output;
    const modeLabel =
      completedJob.settingsUsed.mode === 'auto'
        ? `Otomatis (${completedJob.recommendation.resolvedResolution})`
        : `Manual (${completedJob.recommendation.resolvedResolution})`;

    setHistory((prev) => [
      {
        jobId: completedJob.jobId,
        createdAt: Date.now(),
        originalName: sourceProbe.fileName,
        originalSize: sourceProbe.fileSize,
        originalResolution: `${sourceProbe.width}×${sourceProbe.height}`,
        outputSize: out.fileSize,
        outputResolution: `${out.width}×${out.height}`,
        outputBitrateKbps: out.videoBitrateKbps,
        savingsPercent: out.savingsPercent,
        downloadUrl: out.downloadUrl,
        streamUrl: out.streamUrl,
        sourceStreamUrl: sourceUrl,
        modeLabel,
      },
      ...prev,
    ]);
  };

  const handleVideoUpload = async (file: File) => {
    setUploadError(null);
    setEncodeError(null);
    setIsUploading(true);
    setActiveJob(null);

    try {
      if (!backendAvailable) {
        const { probe: browserProbe, blobUrl } = await probeVideoInBrowser(file);
        setLocalFile(file);
        setLocalStreamUrl(blobUrl);
        setProbe(browserProbe);
        setSettings(buildDefaultSettings(browserProbe));
        setWorkspaceTab('web');
        return;
      }

      const formData = new FormData();
      formData.append('video', file);

      const res = await fetch('/api/probe', {
        method: 'POST',
        body: formData,
      });
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (!isJson) {
        // Fallback seamlessly if server route isn't present
        setBackendAvailable(false);
        const { probe: browserProbe, blobUrl } = await probeVideoInBrowser(file);
        setLocalFile(file);
        setLocalStreamUrl(blobUrl);
        setProbe(browserProbe);
        setSettings(buildDefaultSettings(browserProbe));
        setWorkspaceTab('web');
        return;
      }

      const data = (await res.json()) as VideoProbeInfo & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membaca file video.');
      }

      setLocalFile(file);
      setLocalStreamUrl(null);
      setProbe(data);
      setSettings(buildDefaultSettings(data));
      setWorkspaceTab('web');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Gagal mengunggah video.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerateSample = async (): Promise<string | null> => {
    setUploadError(null);
    setEncodeError(null);
    setIsGeneratingSample(true);
    setActiveJob(null);

    try {
      if (!backendAvailable) {
        const sample = await generateSampleInBrowser();
        setLocalFile(sample.file);
        setLocalStreamUrl(sample.blobUrl);
        setProbe(sample.probe);
        setSettings(buildDefaultSettings(sample.probe));
        return sample.probe.fileId;
      }

      const res = await fetch('/api/sample', { method: 'POST' });
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (!isJson) {
        setBackendAvailable(false);
        const sample = await generateSampleInBrowser();
        setLocalFile(sample.file);
        setLocalStreamUrl(sample.blobUrl);
        setProbe(sample.probe);
        setSettings(buildDefaultSettings(sample.probe));
        return sample.probe.fileId;
      }

      const data = (await res.json()) as VideoProbeInfo & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membuat video sampel.');
      }
      setLocalFile(null);
      setLocalStreamUrl(null);
      setProbe(data);
      setSettings(buildDefaultSettings(data));
      return data.fileId;
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Gagal membuat video sampel.');
      return null;
    } finally {
      setIsGeneratingSample(false);
    }
  };

  const handleStartEncode = async () => {
    if (!probe || !settings) return;
    setEncodeError(null);
    setIsStartingEncode(true);

    try {
      if (!backendAvailable) {
        if (!localFile) {
          throw new Error('File video lokal tidak ditemukan. Silakan pilih ulang video.');
        }
        const plan = computeEncodingPlan(probe, settings);
        const initialStatus: EncodeJobStatus = {
          jobId: `browser_pending_${Date.now()}`,
          fileId: probe.fileId,
          status: 'processing',
          progress: 2,
          fps: plan.targetFps,
          speed: 'WASM',
          startedAt: Date.now(),
          settingsUsed: settings,
          recommendation: plan,
        };
        setActiveJob(initialStatus);
        setIsStartingEncode(false);

        const completed = await encodeVideoInBrowser(localFile, probe, settings, (pct) => {
          setActiveJob((prev) =>
            prev && prev.status === 'processing' ? { ...prev, progress: pct } : prev
          );
        });
        setActiveJob(completed);
        recordCompletedHistory(completed, probe, localStreamUrl || '');
        return;
      }

      const res = await fetch('/api/encode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: probe.fileId,
          settings,
        }),
      });
      const data = (await res.json()) as EncodeJobStatus & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memulai proses encode.');
      }
      setActiveJob(data);
    } catch (err) {
      setEncodeError(err instanceof Error ? err.message : 'Gagal memulai proses encode.');
      setActiveJob((prev) => (prev ? { ...prev, status: 'error' } : null));
    } finally {
      setIsStartingEncode(false);
    }
  };

  const handlePreviewHistoryItem = (item: SessionHistoryItem) => {
    setPreviewHistoryItem(item);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Hidden Global File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleVideoUpload(file);
          e.target.value = '';
        }}
      />

      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#workspace-top"
            onClick={() => setWorkspaceTab('web')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            StatusOptic
          </a>

          {/* Zone 2: 4 single-line nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => {
                setWorkspaceTab('web');
                document.getElementById('workspace-top')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceTab === 'web' ? 'text-slate-900 underline underline-offset-4' : ''
              }`}
            >
              Encoder Web
            </button>
            <button
              type="button"
              onClick={() => {
                setWorkspaceTab('bot');
                document.getElementById('workspace-top')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceTab === 'bot' ? 'text-slate-900 underline underline-offset-4' : ''
              }`}
            >
              Bot WhatsApp
            </button>
            <a
              href="#cara-kerja"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Cara Kerja
            </a>
            <a
              href="#riwayat"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Riwayat
            </a>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isUploading ? 'Mengunggah...' : 'Pilih Video'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main id="workspace-top" className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-10">
        {/* Hero & Mode Switcher */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="max-w-2xl space-y-2.5">
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
              Encoder Video Story WhatsApp Anti-Buram
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Kompresi otomatis dengan pilihan resolusi 540p, 720p, hingga 1080p dalam profil H.264
              terkendali—dapat dijalankan langsung lewat web atau dihubungkan ke bot WhatsApp Anda.
            </p>
          </div>

          {/* Workspace Mode Segmented Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start lg:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setWorkspaceTab('web')}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                workspaceTab === 'web'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Encoder Web
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceTab('bot')}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                workspaceTab === 'bot'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
              Bot WhatsApp &amp; API
            </button>
          </div>
        </div>

        {/* Workspace Content */}
        {workspaceTab === 'bot' ? (
          <BotWhatsAppPanel
            backendAvailable={backendAvailable}
            currentFileId={probe?.fileId ?? null}
            currentFileName={probe?.fileName ?? null}
            currentLocalFile={localFile}
            currentProbe={probe}
            onEnsureSample={handleGenerateSample}
          />
        ) : (
          <div className="space-y-8">
            {/* Upload Dropzone (Full when empty, compact bar when video loaded) */}
            {!probe || !settings ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleVideoUpload(file);
                }}
                className={`bg-white border-2 border-dashed rounded-xl p-10 sm:p-14 text-center transition-colors ${
                  isDragging
                    ? 'border-emerald-600 bg-emerald-50/40'
                    : 'border-slate-300 hover:border-slate-400'
                }`}
              >
                <div className="max-w-md mx-auto space-y-5">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
                    {isUploading || isGeneratingSample ? (
                      <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                    ) : (
                      <UploadCloud className="w-6 h-6" />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <h2 className="font-display text-lg font-semibold text-slate-900">
                      {isUploading
                        ? 'Menganalisis struktur video dengan FFprobe...'
                        : isGeneratingSample
                          ? 'Membuat video sampel 1080p 60fps...'
                          : 'Tarik & lepas video di sini'}
                    </h2>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Mendukung MP4, MOV (iPhone), MKV, WebM hingga 350 MB. Semua parameter
                      (bitrate, HDR, FPS) akan diperiksa otomatis.
                    </p>
                  </div>

                  {uploadError && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                      {uploadError}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                    <button
                      type="button"
                      disabled={isUploading || isGeneratingSample}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded-lg transition-colors cursor-pointer"
                    >
                      Pilih File Video
                    </button>
                    <button
                      type="button"
                      disabled={isUploading || isGeneratingSample}
                      onClick={() => void handleGenerateSample()}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Film className="w-4 h-4 text-emerald-600" />
                      Uji dengan Video Sampel
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Compact Loaded File Bar */}
                <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileVideo className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate max-w-[320px] sm:max-w-[460px]">
                        {probe.fileName}
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums">
                        {probe.width}×{probe.height} · {probe.fps} fps · {formatBytes(probe.fileSize)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                    >
                      Ganti Video
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkspaceTab('bot')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Uji via Bot WA
                    </button>
                  </div>
                </div>

                {/* Main 2-Column Studio Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  {/* Left Column (7 cols): Preview & Diagnostics */}
                  <div className="lg:col-span-7 space-y-6">
                    <VideoPreviewStudio
                      probe={probe}
                      sourceStreamUrl={localStreamUrl || `/api/files/${probe.fileId}/stream`}
                      activeJob={activeJob}
                    />
                    <DiagnosticsPanel probe={probe} />
                  </div>

                  {/* Right Column (5 cols): Encoder Settings */}
                  <div className="lg:col-span-5 lg:sticky lg:top-24">
                    <EncoderControls
                      probe={probe}
                      settings={settings}
                      onChange={setSettings}
                      onStartEncode={() => void handleStartEncode()}
                      onResetDefaults={() => setSettings(buildDefaultSettings(probe))}
                      activeJob={activeJob}
                      isStarting={isStartingEncode}
                      encodeError={encodeError}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Educational & History Sections */}
        <EducationalSections
          history={history}
          onPreviewHistoryItem={handlePreviewHistoryItem}
        />
      </main>

      {/* Clean Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white mt-16">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>StatusOptic · Optimasi Video Story WhatsApp</span>
          <span>Pemrosesan sementara di server &amp; otomatis terhapus setelah 45 menit</span>
        </div>
      </footer>

      {/* History Video Preview Modal */}
      {previewHistoryItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewHistoryItem(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {previewHistoryItem.originalName}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-500">
                  {previewHistoryItem.outputResolution} · {formatBytes(previewHistoryItem.outputSize)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewHistoryItem(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
                aria-label="Tutup pratinjau"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-black flex items-center justify-center p-3">
              <video
                src={previewHistoryItem.streamUrl}
                controls
                autoPlay
                playsInline
                className="max-h-[65vh] rounded-lg"
              />
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
              <span className="text-xs text-slate-600">{previewHistoryItem.modeLabel}</span>
              <a
                href={previewHistoryItem.downloadUrl}
                download
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Unduh MP4
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
