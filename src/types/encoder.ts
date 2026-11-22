export type ResolutionOption = 'auto' | '1080p' | '720p' | '540p' | 'original';
export type AspectMode = 'keep' | 'fit916' | 'fill916';
export type CompressionMode = 'auto' | 'manual';
export type FpsOption = 'auto' | '30' | '24' | 'keep';

export interface VideoDiagnosticIssue {
  id: string;
  severity: 'critical' | 'warning' | 'ok';
  title: string;
  detail: string;
}

export interface VideoProbeInfo {
  fileId: string;
  fileName: string;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  codec: string;
  profile: string;
  pixFmt: string;
  colorTransfer: string;
  isHdr: boolean;
  fps: number;
  videoBitrateKbps: number;
  totalBitrateKbps: number;
  hasAudio: boolean;
  audioCodec: string;
  audioBitrateKbps: number;
  waRiskLevel: 'high' | 'medium' | 'low';
  waRiskSummary: string;
  diagnostics: VideoDiagnosticIssue[];
}

export interface EncodeSettings {
  mode: CompressionMode;
  resolution: ResolutionOption;
  aspectMode: AspectMode;
  targetSizeMb: number; // e.g., 14.2 for WA Safe, 10, 16, or 0 for CRF-driven
  useTargetSizeCap: boolean;
  crf: number; // 18..28
  fps: FpsOption;
  sharpen: boolean;
  normalizeHdr: boolean;
  trimStart: number;
  trimEnd: number;
}

export interface AutoRecommendation {
  resolvedResolution: Exclude<ResolutionOption, 'auto'>;
  targetWidth: number;
  targetHeight: number;
  targetMaxBitrateKbps: number;
  crf: number;
  targetFps: number;
  estimatedSizeMb: number;
  reason: string;
}

export interface EncodeJobStatus {
  jobId: string;
  fileId: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  progress: number; // 0..100
  fps: number;
  speed: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  settingsUsed: EncodeSettings;
  recommendation: AutoRecommendation;
  output?: {
    fileName: string;
    fileSize: number;
    duration: number;
    width: number;
    height: number;
    codec: string;
    pixFmt: string;
    fps: number;
    videoBitrateKbps: number;
    totalBitrateKbps: number;
    savingsPercent: number;
    downloadUrl: string;
    streamUrl: string;
  };
}

export interface SessionHistoryItem {
  jobId: string;
  createdAt: number;
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
}
