export interface ASRConfig {
  /** Whisper model size: tiny, base, small, medium, large-v3 */
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
  /** Language code (default: 'en') */
  language: string;
  /** Device: 'cuda' for GPU, 'cpu' for CPU inference */
  device: 'cuda' | 'cpu';
  /** Whisper server URL (if using whisper.cpp server or faster-whisper API) */
  serverUrl?: string;
  /** Sample rate in Hz (default: 16000) */
  sampleRate: number;
  /** Enable word-level timestamps */
  wordTimestamps: boolean;
}

export interface TranscriptionResult {
  text: string;
  segments: ASRSegment[];
  language: string;
  duration: number;
  processingTime: number;
}

export interface ASRSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  confidence: number;
  words?: ASRWord[];
}

export interface ASRWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface DiarizationResult {
  segments: DiarizedSegment[];
  speakers: SpeakerProfile[];
  totalSpeakers: number;
}

export interface DiarizedSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export interface SpeakerProfile {
  id: string;
  label: string; // 'doctor', 'patient', 'nurse', 'unknown'
  totalSpeakingTime: number;
  segmentCount: number;
}

export interface AudioChunk {
  data: Buffer;
  sampleRate: number;
  channels: number;
  timestamp: number;
  duration: number;
}

export interface PipelineConfig {
  asr: ASRConfig;
  enableDiarization: boolean;
  enableNoiseReduction: boolean;
  /** Silence threshold in dB (below this = silence, skip ASR) */
  silenceThresholdDb: number;
  /** Minimum speech duration in ms to trigger ASR */
  minSpeechDurationMs: number;
  /** Buffer size in seconds for streaming ASR */
  bufferSeconds: number;
}
