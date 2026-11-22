import { useRef, useState } from 'react';
import {
  Columns2,
  Download,
  Film,
  Maximize2,
  Pause,
  Play,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { EncodeJobStatus, VideoProbeInfo } from '../types/encoder.ts';
import { formatBytes, formatDuration } from '../utils/waCompressionMath.ts';

interface VideoPreviewStudioProps {
  probe: VideoProbeInfo;
  sourceStreamUrl: string;
  activeJob: EncodeJobStatus | null;
}

export function VideoPreviewStudio({
  probe,
  sourceStreamUrl,
  activeJob,
}: VideoPreviewStudioProps) {
  const hasOutput = activeJob?.status === 'completed' && Boolean(activeJob.output);
  const [viewMode, setViewMode] = useState<'source' | 'compare' | 'output'>('source');
  const [showStoryGuide, setShowStoryGuide] = useState(false);

  // Synced playback state for comparison mode
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const outputVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const effectiveMode = !hasOutput && viewMode !== 'source' ? 'source' : viewMode;

  const toggleSyncedPlayback = () => {
    const src = sourceVideoRef.current;
    const out = outputVideoRef.current;
    if (!src || !out) return;

    if (src.paused) {
      out.currentTime = src.currentTime;
      void src.play();
      void out.play();
      setIsPlaying(true);
    } else {
      src.pause();
      out.pause();
      setIsPlaying(false);
    }
  };

  const toggleSyncedMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (sourceVideoRef.current) sourceVideoRef.current.muted = nextMuted;
    if (outputVideoRef.current) outputVideoRef.current.muted = true; // Keep 1 audio track active in compare
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('source')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              effectiveMode === 'source'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Video Asli
          </button>
          <button
            type="button"
            disabled={!hasOutput}
            onClick={() => setViewMode('output')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              !hasOutput
                ? 'text-slate-400 cursor-not-allowed'
                : effectiveMode === 'output'
                  ? 'bg-white text-slate-900 shadow-xs cursor-pointer'
                  : 'text-slate-600 hover:text-slate-900 cursor-pointer'
            }`}
          >
            Hasil Encode
          </button>
          <button
            type="button"
            disabled={!hasOutput}
            onClick={() => {
              setIsPlaying(false);
              setViewMode('compare');
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              !hasOutput
                ? 'text-slate-400 cursor-not-allowed'
                : effectiveMode === 'compare'
                  ? 'bg-white text-slate-900 shadow-xs cursor-pointer'
                  : 'text-slate-600 hover:text-slate-900 cursor-pointer'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            Bandingkan
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowStoryGuide((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showStoryGuide
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Bingkai Story WA
          </button>

          {hasOutput && activeJob?.output && (
            <a
              href={activeJob.output.downloadUrl}
              download={activeJob.output.fileName}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh Hasil
            </a>
          )}
        </div>
      </div>

      {/* Viewport */}
      <div className="bg-slate-950 relative">
        {effectiveMode === 'compare' && activeJob?.output ? (
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-300 font-mono tabular-nums">
                  <span className="font-sans font-medium text-slate-200">Asli (Sumber)</span>
                  <span>
                    {probe.width}×{probe.height} · {formatBytes(probe.fileSize)}
                  </span>
                </div>
                <div className="relative bg-black rounded-lg overflow-hidden aspect-[9/16] max-h-[420px] mx-auto flex items-center justify-center border border-slate-800">
                  <video
                    ref={sourceVideoRef}
                    src={sourceStreamUrl}
                    muted={isMuted}
                    playsInline
                    loop
                    onEnded={() => setIsPlaying(false)}
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-emerald-400 font-mono tabular-nums">
                  <span className="font-sans font-medium text-emerald-300">Hasil Optimasi WA</span>
                  <span>
                    {activeJob.output.width}×{activeJob.output.height} ·{' '}
                    {formatBytes(activeJob.output.fileSize)}
                  </span>
                </div>
                <div className="relative bg-black rounded-lg overflow-hidden aspect-[9/16] max-h-[420px] mx-auto flex items-center justify-center border border-emerald-500/40">
                  <video
                    ref={outputVideoRef}
                    src={activeJob.output.streamUrl}
                    muted
                    playsInline
                    loop
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={toggleSyncedPlayback}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPlaying ? 'Jeda Bersamaan' : 'Putar Bersamaan'}
              </button>
              <button
                type="button"
                onClick={toggleSyncedMute}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {isMuted ? 'Suara Mati' : 'Suara Aktif'}
              </button>
            </div>
          </div>
        ) : (
          <div className="relative flex items-center justify-center p-4 min-h-[360px] max-h-[500px]">
            <div className="relative w-full max-w-[300px] sm:max-w-[340px] flex items-center justify-center">
              <video
                key={effectiveMode === 'output' && activeJob?.output ? activeJob.output.streamUrl : sourceStreamUrl}
                src={
                  effectiveMode === 'output' && activeJob?.output
                    ? activeJob.output.streamUrl
                    : sourceStreamUrl
                }
                controls
                playsInline
                className="w-full max-h-[440px] rounded-lg bg-black object-contain"
              />

              {showStoryGuide && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <div className="h-full aspect-[9/16] border-2 border-dashed border-emerald-400/80 rounded-lg relative">
                    <div className="absolute top-2 inset-x-3 flex items-center gap-1">
                      <span className="h-0.5 flex-1 bg-white/80 rounded-full" />
                      <span className="h-0.5 flex-1 bg-white/35 rounded-full" />
                    </div>
                    <div className="absolute top-5 left-3 right-3 flex items-center justify-between text-[10px] text-white/90 font-medium drop-shadow">
                      <span>Area Aman Header Status</span>
                    </div>
                    <div className="absolute bottom-8 inset-x-3 text-center text-[10px] text-white/80 bg-black/50 py-1 rounded">
                      Area Balasan & Caption WA
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Clean Unboxed Metadata Strip */}
      <div className="px-4 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="font-medium text-slate-900 truncate max-w-[220px]" title={probe.fileName}>
            {probe.fileName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums text-slate-600">
          {effectiveMode === 'output' && activeJob?.output ? (
            <>
              <span className="text-emerald-700 font-semibold">
                {activeJob.output.width}×{activeJob.output.height}
              </span>
              <span aria-hidden="true">·</span>
              <span>{activeJob.output.fps} fps</span>
              <span aria-hidden="true">·</span>
              <span>{activeJob.output.codec.toUpperCase()} ({activeJob.output.pixFmt})</span>
              <span aria-hidden="true">·</span>
              <span>{(activeJob.output.videoBitrateKbps / 1000).toFixed(2)} Mbps</span>
              <span aria-hidden="true">·</span>
              <span>{formatDuration(activeJob.output.duration)}</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-700 font-semibold">
                {formatBytes(activeJob.output.fileSize)}
              </span>
            </>
          ) : (
            <>
              <span>
                {probe.width}×{probe.height}
              </span>
              <span aria-hidden="true">·</span>
              <span>{probe.fps} fps</span>
              <span aria-hidden="true">·</span>
              <span>
                {probe.codec.toUpperCase()} ({probe.isHdr ? 'HDR 10-bit' : probe.pixFmt})
              </span>
              <span aria-hidden="true">·</span>
              <span>{(probe.videoBitrateKbps / 1000).toFixed(2)} Mbps</span>
              <span aria-hidden="true">·</span>
              <span>{formatDuration(probe.duration)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-900">{formatBytes(probe.fileSize)}</span>
            </>
          )}
        </div>
      </div>

      {/* Result Comparison Strip if completed */}
      {hasOutput && activeJob?.output && (
        <div className="px-4 py-3 border-t border-emerald-200 bg-emerald-50/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-emerald-900">
            <Maximize2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              Kompresi selesai:{' '}
              <strong className="font-mono tabular-nums">{formatBytes(probe.fileSize)}</strong>
              {' → '}
              <strong className="font-mono tabular-nums">
                {formatBytes(activeJob.output.fileSize)}
              </strong>{' '}
              ({activeJob.output.savingsPercent >= 0 ? `hemat ${activeJob.output.savingsPercent}%` : 'ukuran disesuaikan'})
            </span>
          </div>
          <span className="text-emerald-800 font-medium">
            Siap diunggah ke Story WA tanpa kompresi paksa
          </span>
        </div>
      )}
    </div>
  );
}
