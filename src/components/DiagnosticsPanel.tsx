import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { VideoProbeInfo } from '../types/encoder.ts';

interface DiagnosticsPanelProps {
  probe: VideoProbeInfo;
}

export function DiagnosticsPanel({ probe }: DiagnosticsPanelProps) {
  const riskHeading =
    probe.waRiskLevel === 'high'
      ? 'Risiko Tinggi Buram di Story WA'
      : probe.waRiskLevel === 'medium'
        ? 'Perlu Penyesuaian Parameter'
        : 'Sudah Mendekati Standar WA';

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Analisis Risiko Kompresi WhatsApp
          </h3>
          <p className="text-sm text-slate-600">{probe.waRiskSummary}</p>
        </div>

        <div
          className={`inline-flex items-center gap-1.5 text-xs font-semibold shrink-0 whitespace-nowrap ${
            probe.waRiskLevel === 'high'
              ? 'text-red-700'
              : probe.waRiskLevel === 'medium'
                ? 'text-amber-700'
                : 'text-emerald-700'
          }`}
        >
          {probe.waRiskLevel === 'high' ? (
            <ShieldAlert className="w-4 h-4" />
          ) : probe.waRiskLevel === 'medium' ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          <span>{riskHeading}</span>
        </div>
      </div>

      <div className="divide-y divide-slate-100 border-t border-slate-100">
        {probe.diagnostics.map((item) => {
          const statusLabel =
            item.severity === 'critical'
              ? 'Pemicu Blur'
              : item.severity === 'warning'
                ? 'Perlu Diatur'
                : 'Aman';

          const statusColor =
            item.severity === 'critical'
              ? 'text-red-700'
              : item.severity === 'warning'
                ? 'text-amber-700'
                : 'text-emerald-700';

          return (
            <div key={item.id} className="py-3 first:pt-3 last:pb-0 flex items-start justify-between gap-4">
              <div className="space-y-0.5 min-w-0">
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                <p className="text-xs text-slate-600 leading-relaxed">{item.detail}</p>
              </div>
              <span className={`text-xs font-semibold shrink-0 whitespace-nowrap ${statusColor}`}>
                {statusLabel}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
