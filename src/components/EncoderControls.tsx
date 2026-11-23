import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import type {
  AspectMode,
  EncodeJobStatus,
  EncodeSettings,
  FpsOption,
  H264ProfileOption,
  ResolutionOption,
  VideoProbeInfo,
  WaPresetProfile,
} from '../types/encoder.ts';
import { computeEncodingPlan, formatBytes, formatDuration } from '../utils/waCompressionMath.ts';

interface EncoderControlsProps {
  probe: VideoProbeInfo;
  settings: EncodeSettings;
  onChange: (next: EncodeSettings) => void;
  onStartEncode: () => void;
  onResetDefaults: () => void;
  activeJob: EncodeJobStatus | null;
  isStarting: boolean;
  encodeError: string | null;
}

const WA_PRESET_OPTIONS: Array<{
  value: WaPresetProfile;
  label: string;
  sub: string;
}> = [
  { value: 'pure_hd_1080', label: 'PureHD 1080p', sub: '1080p · ~3.8 Mbps' },
  { value: 'balanced_720', label: 'Tajam 720p', sub: '720p · ~2.0 Mbps' },
  { value: 'strict_bypass', label: 'Hemat Ketat', sub: '720p · ~1.25 Mbps' },
];

const RESOLUTION_OPTIONS: Array<{
  value: ResolutionOption;
  label: string;
  hint: string;
}> = [
  { value: 'auto', label: 'Otomatis', hint: 'Ikuti preset' },
  { value: '720p', label: '720p WA', hint: '720×1280' },
  { value: '1080p', label: '1080p HD', hint: '1080×1920' },
  { value: '540p', label: '540p Hemat', hint: '540×960' },
  { value: 'original', label: 'Asli', hint: 'Tanpa resize' },
];

const ASPECT_OPTIONS: Array<{ value: AspectMode; label: string }> = [
  { value: 'keep', label: 'Proporsional' },
  { value: 'fit916', label: 'Fit 9:16' },
  { value: 'fill916', label: 'Crop 9:16' },
];

const FPS_OPTIONS: Array<{ value: FpsOption; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '30', label: '30 fps' },
  { value: '24', label: '24 fps' },
  { value: 'keep', label: 'Asli' },
];

const H264_PROFILES: Array<{ value: H264ProfileOption; label: string }> = [
  { value: 'baseline', label: 'Baseline (Aman WA)' },
  { value: 'main', label: 'Main' },
  { value: 'high', label: 'High' },
];

export function EncoderControls({
  probe,
  settings,
  onChange,
  onStartEncode,
  onResetDefaults,
  activeJob,
  isStarting,
  encodeError,
}: EncoderControlsProps) {
  const [showAdvancedInAuto, setShowAdvancedInAuto] = useState(false);

  const plan = computeEncodingPlan(probe, settings);
  const isProcessing =
    isStarting || activeJob?.status === 'queued' || activeJob?.status === 'processing';

  const trimmedDuration = Math.max(
    0.5,
    (settings.trimEnd > settings.trimStart ? settings.trimEnd : probe.duration) -
      settings.trimStart
  );

  const update = <K extends keyof EncodeSettings>(key: K, value: EncodeSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const handleModeSwitch = (mode: 'auto' | 'manual') => {
    if (mode === 'auto') {
      onChange({
        ...settings,
        mode: 'auto',
        waPreset: 'pure_hd_1080',
        h264Profile: 'high',
        useTargetSizeCap: true,
        targetSizeMb: 14.5,
        fps: 'auto',
        sharpen: true,
        normalizeHdr: true,
      });
    } else {
      onChange({
        ...settings,
        mode: 'manual',
        resolution: settings.resolution === 'auto' ? plan.resolvedResolution : settings.resolution,
      });
    }
  };

  const showAdvancedSection = settings.mode === 'manual' || showAdvancedInAuto;

  return (
    <aside className="bg-white border border-slate-200 rounded-xl p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Pengaturan Kompresi
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Atur profil encoding agar video tidak dikompres ulang WhatsApp
          </p>
        </div>
        <button
          type="button"
          onClick={onResetDefaults}
          disabled={isProcessing}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>

      {/* Mode Switcher */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-slate-700">Mode Kompresi</label>
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => handleModeSwitch('auto')}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              settings.mode === 'auto'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-emerald-600" />
            Otomatis (WA)
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => handleModeSwitch('manual')}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              settings.mode === 'manual'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Manual / Kustom
          </button>
        </div>
      </div>

      {/* Auto Mode Target Profile */}
      {settings.mode === 'auto' && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-700">
            Target Kompresi Story WA
          </label>
          <div className="grid grid-cols-3 gap-2">
            {WA_PRESET_OPTIONS.map((opt) => {
              const active = settings.waPreset === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => update('waPreset', opt.value)}
                  className={`text-left px-2.5 py-2 rounded-lg border transition-colors cursor-pointer disabled:opacity-60 ${
                    active
                      ? 'border-emerald-600 bg-emerald-50/70 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-semibold whitespace-nowrap">{opt.label}</div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5 truncate">
                    {opt.sub}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Resolution Selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700">Pilihan Resolusi Output</label>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            Terpilih: {plan.targetWidth}×{plan.targetHeight}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {RESOLUTION_OPTIONS.filter(
            (opt) => settings.mode === 'auto' || opt.value !== 'auto'
          ).map((opt) => {
            const active = settings.resolution === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={isProcessing}
                onClick={() => update('resolution', opt.value)}
                className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-60 ${
                  active
                    ? 'border-emerald-600 bg-emerald-50/70 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-semibold whitespace-nowrap">{opt.label}</div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                  {opt.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Aspect Framing */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-slate-700">
          Rasio Layar Story (9:16)
        </label>
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
          {ASPECT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={isProcessing}
              onClick={() => update('aspectMode', opt.value)}
              className={`px-2.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                settings.aspectMode === opt.value
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trim Duration */}
      <div className="space-y-2.5 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Scissors className="w-3.5 h-3.5 text-slate-500" />
            <span>Potong Durasi Klip</span>
          </div>
          <div className="flex items-center gap-2">
            {probe.duration > 30.2 && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onChange({ ...settings, trimStart: 0, trimEnd: 30 })}
                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-2 cursor-pointer"
              >
                Set 30s Awal
              </button>
            )}
            <span className="text-xs font-mono tabular-nums text-slate-600">
              {formatDuration(trimmedDuration)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Mulai ({formatDuration(settings.trimStart)})
            </label>
            <input
              type="range"
              min={0}
              max={Math.max(0, Number((probe.duration - 1).toFixed(1)))}
              step={0.5}
              value={settings.trimStart}
              disabled={isProcessing}
              onChange={(e) => {
                const nextStart = Number(e.target.value);
                const nextEnd = Math.max(nextStart + 1, settings.trimEnd);
                onChange({
                  ...settings,
                  trimStart: nextStart,
                  trimEnd: Math.min(probe.duration, nextEnd),
                });
              }}
              className="w-full studio-slider"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Selesai ({formatDuration(settings.trimEnd)})
            </label>
            <input
              type="range"
              min={Math.min(probe.duration, settings.trimStart + 1)}
              max={probe.duration}
              step={0.5}
              value={settings.trimEnd}
              disabled={isProcessing}
              onChange={(e) => {
                const nextEnd = Number(e.target.value);
                onChange({
                  ...settings,
                  trimEnd: Math.max(settings.trimStart + 0.5, nextEnd),
                });
              }}
              className="w-full studio-slider"
            />
          </div>
        </div>
      </div>

      {/* Advanced Controls Toggle (in Auto mode) */}
      {settings.mode === 'auto' && (
        <button
          type="button"
          onClick={() => setShowAdvancedInAuto((v) => !v)}
          className="w-full flex items-center justify-between py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border-t border-slate-100 cursor-pointer"
        >
          <span>Opsi Tambahan (Ketajaman, HDR, FPS)</span>
          {showAdvancedInAuto ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      )}

      {/* Advanced / Manual Controls */}
      {showAdvancedSection && (
        <div className="space-y-4 pt-2 border-t border-slate-100">
          {settings.mode === 'manual' && (
            <>
              {/* H.264 Profile Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Profil H.264 Kompatibilitas WA
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  {H264_PROFILES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isProcessing}
                      onClick={() => update('h264Profile', opt.value)}
                      className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        settings.h264Profile === opt.value
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target Size Cap */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.useTargetSizeCap}
                      disabled={isProcessing}
                      onChange={(e) => update('useTargetSizeCap', e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Batasi Ukuran Maksimal File
                  </label>
                  {settings.useTargetSizeCap && (
                    <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                      {settings.targetSizeMb.toFixed(1)} MB
                    </span>
                  )}
                </div>

                {settings.useTargetSizeCap && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {[10.5, 12.5, 14.5].map((mb) => (
                      <button
                        key={mb}
                        type="button"
                        disabled={isProcessing}
                        onClick={() => update('targetSizeMb', mb)}
                        className={`py-1.5 px-2 text-xs font-mono tabular-nums rounded-md border transition-colors cursor-pointer ${
                          Math.abs(settings.targetSizeMb - mb) < 0.1
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {mb === 14.5 ? '14.5 MB (HD)' : `${mb} MB`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* CRF Quality Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Kualitas Video (CRF)</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    CRF {settings.crf} ({settings.crf <= 20 ? 'Ultra Tajam' : settings.crf <= 23 ? 'Seimbang' : 'Hemat'})
                  </span>
                </div>
                <input
                  type="range"
                  min={18}
                  max={28}
                  step={1}
                  value={settings.crf}
                  disabled={isProcessing}
                  onChange={(e) => update('crf', Number(e.target.value))}
                  className="w-full studio-slider"
                />
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>18 (Paling Tajam)</span>
                  <span>28 (Ukuran Kecil)</span>
                </div>
              </div>
            </>
          )}

          {/* FPS Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">Frame Rate (FPS)</label>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
              {FPS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => update('fps', opt.value)}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    settings.fps === opt.value
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sharpness & HDR normalization checkboxes */}
          <div className="space-y-2.5 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.sharpen}
                disabled={isProcessing}
                onChange={(e) => update('sharpen', e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                <strong className="font-semibold text-slate-900">Penajaman tepi ringan (Lanczos + Unsharp)</strong>
                <span className="block text-slate-500">
                  Menjaga teks dan detail wajah tetap tajam saat resolusi diturunkan ke 720p.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.normalizeHdr}
                disabled={isProcessing}
                onChange={(e) => update('normalizeHdr', e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                <strong className="font-semibold text-slate-900">Normalisasi warna HDR ke SDR (BT.709)</strong>
                <span className="block text-slate-500">
                  Mencegah warna terlihat pudar atau kelabu pada rekaman iPhone/Android 10-bit HDR.
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Live Output Estimate Summary */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
          <span>Estimasi Profil Output</span>
          <span className="font-mono text-[11px] text-slate-500">
            {plan.h264Profile.toUpperCase()}@L{plan.h264Level}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">Dimensi</span>
            <span className="font-mono tabular-nums font-medium text-slate-900">
              {plan.targetWidth}×{plan.targetHeight}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Max Bitrate</span>
            <span className="font-mono tabular-nums font-medium text-slate-900">
              {(plan.targetMaxBitrateKbps / 1000).toFixed(2)} Mbps
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Frame Rate</span>
            <span className="font-mono tabular-nums font-medium text-slate-900">
              {plan.targetFps} fps CFR
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Est. Ukuran</span>
            <span className="font-mono tabular-nums font-semibold text-emerald-700">
              ~{plan.estimatedSizeMb} MB
            </span>
          </div>
        </div>
        <p className="text-[11px] text-slate-600 leading-relaxed border-t border-slate-200 pt-2">
          {plan.reason}
        </p>
      </div>

      {/* Error Message */}
      {encodeError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {encodeError}
        </div>
      )}

      {/* Progress State */}
      {isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-800 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
              Meng-encode H.264 + AAC...
            </span>
            <span className="font-mono tabular-nums text-slate-600">
              {activeJob?.progress ?? 0}% · {activeJob?.speed || '1.0x'}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all duration-200"
              style={{ width: `${Math.max(4, activeJob?.progress ?? 4)}%` }}
            />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={onStartEncode}
          disabled={isProcessing}
          className="w-full py-3 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {isProcessing
            ? `Sedang Memproses (${activeJob?.progress ?? 0}%)...`
            : activeJob?.status === 'completed'
              ? 'Encode Ulang dengan Pengaturan Ini'
              : 'Proses & Encode Video'}
        </button>

        {activeJob?.status === 'completed' && activeJob.output && (
          <>
            <a
              href={activeJob.output.downloadUrl}
              download={activeJob.output.fileName}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
            >
              <Download className="w-4 h-4" />
              Unduh MP4 ({formatBytes(activeJob.output.fileSize)})
            </a>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed space-y-1">
              <div className="font-semibold text-slate-800">
                Tips Posting Story (Khususnya iPhone / iOS):
              </div>
              <p>
                1. Simpan video ke <strong>Foto (Photos)</strong>. Jika di editor Story WA muncul
                tombol <strong>HD</strong> di bagian atas, pastikan Anda menyalakannya.
              </p>
              <p>
                2. Cara paling ampuh jika Story langsung tetap memburamkan: kirim hasil MP4 ini ke{' '}
                <strong>Chat Diri Sendiri (Message Yourself)</strong> dengan kualitas{' '}
                <strong>HD</strong>, lalu tekan <strong>Teruskan (Forward) → Status Saya</strong>.
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
