import { Download, Play } from 'lucide-react';
import type { SessionHistoryItem } from '../types/encoder.ts';
import { formatBytes } from '../utils/waCompressionMath.ts';

interface EducationalSectionsProps {
  history: SessionHistoryItem[];
  onPreviewHistoryItem: (item: SessionHistoryItem) => void;
}

export function EducationalSections({
  history,
  onPreviewHistoryItem,
}: EducationalSectionsProps) {
  return (
    <div className="space-y-16 pt-12 border-t border-slate-200">
      {/* Section 1: Cara Kerja */}
      <section id="cara-kerja" className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <h2 className="font-display text-2xl font-bold text-slate-900">
            Mengapa Video Story WA Sering Buram Saat Langsung Diunggah?
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Bukan karena jaringan internet. Ketika file video mentah dari kamera HP melebihi batas
            ukuran (~16 MB) atau menggunakan bitrate dan codec tinggi, server WhatsApp langsung
            mengambil alih dan mengompres ulang video dengan preset cepat ber-bitrate sangat rendah.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="text-xs font-mono font-semibold text-emerald-700">01. Batas Envelop 14–16 MB</div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Menghindari Kompresi Paksa Server
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Video 15 detik dari kamera HP sering berukuran 30–60 MB (20+ Mbps). Dengan menjaga
              ukuran di bawah ~14.2 MB dan bitrate terkendali, WhatsApp tidak perlu memangkas kualitas
              secara ekstrem.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="text-xs font-mono font-semibold text-emerald-700">02. H.264 High@L4.0 + BT.709</div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Normalisasi Codec & Warna HDR
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Kamera modern sering merekam dalam HEVC (H.265) atau 10-bit HDR. WhatsApp mewajibkan
              H.264 8-bit SDR (<span className="font-mono text-xs">yuv420p</span>) dengan atom{' '}
              <span className="font-mono text-xs">+faststart</span> agar warna dan ketajaman tidak
              rusak.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="text-xs font-mono font-semibold text-emerald-700">03. Constrained CRF + Lanczos</div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Ketajaman Terjaga di Adegan Cepat
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              StatusOptic memakai teknik bitrate dinamis (<span className="font-mono text-xs">CRF + maxrate</span>)
              dengan filter skala Lanczos dan penajaman tepi ringan agar detail wajah dan teks tetap
              bersih.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: Parameter Comparison Table */}
      <section id="parameter" className="space-y-5">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-slate-900">
            Perbandingan Parameter Video
          </h2>
          <p className="text-sm text-slate-600">
            Perbedaan teknis antara rekaman kamera langsung, hasil kompresi paksa WA, dan output
            StatusOptic.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Parameter</th>
                <th className="py-3 px-4">Kamera Bawaan HP</th>
                <th className="py-3 px-4">Kompresi Paksa WA (Buram)</th>
                <th className="py-3 px-4 text-emerald-800">Output StatusOptic</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr className="hover:bg-slate-50/60">
                <td className="py-3 px-4 font-medium text-slate-900">Resolusi</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs">1080×1920 / 4K</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs text-red-700">480×854 – 720p (lunak)</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs font-semibold text-emerald-700">
                  720×1280 atau 1080×1920
                </td>
              </tr>
              <tr className="hover:bg-slate-50/60">
                <td className="py-3 px-4 font-medium text-slate-900">Bitrate Video</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs">15 – 50 Mbps</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs text-red-700">0.8 – 1.3 Mbps (pecah)</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs font-semibold text-emerald-700">
                  2.2 – 3.8 Mbps (terkendali)
                </td>
              </tr>
              <tr className="hover:bg-slate-50/60">
                <td className="py-3 px-4 font-medium text-slate-900">Codec & Warna</td>
                <td className="py-3 px-4 font-mono text-xs">HEVC / 10-bit HDR</td>
                <td className="py-3 px-4 font-mono text-xs">H.264 Baseline (pudar)</td>
                <td className="py-3 px-4 font-mono text-xs font-semibold text-emerald-700">
                  H.264 High@L4.0 (yuv420p)
                </td>
              </tr>
              <tr className="hover:bg-slate-50/60">
                <td className="py-3 px-4 font-medium text-slate-900">Frame Rate</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs">60 fps (VFR)</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs">24–30 fps (patah-patah)</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs font-semibold text-emerald-700">
                  30 fps CFR stabil
                </td>
              </tr>
              <tr className="hover:bg-slate-50/60">
                <td className="py-3 px-4 font-medium text-slate-900">Ukuran (15 detik)</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs">35 – 90 MB</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs">1.8 – 2.5 MB</td>
                <td className="py-3 px-4 font-mono tabular-nums text-xs font-semibold text-emerald-700">
                  4.5 – 7.5 MB (aman & tajam)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 3: Session History */}
      <section id="riwayat" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900">
              Riwayat Encode Sesi Ini
            </h2>
            <p className="text-sm text-slate-600">
              Daftar video yang telah Anda proses selama sesi ini berlangsung.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {history.length} file selesai
          </span>
        </div>

        {history.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">Belum ada riwayat encode</p>
            <p className="text-xs text-slate-500">
              Unggah video atau coba dengan video sampel di atas untuk melihat hasil perbandingan
              ukuran dan resolusi di sini.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Nama File</th>
                  <th className="py-3 px-4">Mode</th>
                  <th className="py-3 px-4">Resolusi</th>
                  <th className="py-3 px-4 text-right">Asli</th>
                  <th className="py-3 px-4 text-right">Hasil</th>
                  <th className="py-3 px-4 text-right">Hemat</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((item) => (
                  <tr key={item.jobId} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-medium text-slate-900 max-w-[220px] truncate">
                      {item.originalName}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">{item.modeLabel}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700">
                      {item.originalResolution} → {item.outputResolution}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 text-right">
                      {formatBytes(item.originalSize)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs font-semibold text-emerald-700 text-right">
                      {formatBytes(item.outputSize)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 text-right">
                      {item.savingsPercent}%
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onPreviewHistoryItem(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                        >
                          <Play className="w-3 h-3" />
                          Putar
                        </button>
                        <a
                          href={item.downloadUrl}
                          download
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700"
                        >
                          <Download className="w-3 h-3" />
                          Unduh
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
