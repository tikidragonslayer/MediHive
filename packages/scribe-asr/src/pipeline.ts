import { WhisperASR } from './whisper';
import { SpeakerDiarizer } from './diarizer';
import { PipelineConfig, DiarizedSegment, TranscriptionResult, DiarizationResult } from './types';

/**
 * AudioPipeline — End-to-end audio processing for MediScribe.
 *
 * Pipeline:
 * Microphone → Noise reduction → VAD → Whisper ASR → Diarization → Merge → Output
 *
 * All processing happens on the hospital edge GPU.
 * Audio NEVER leaves the hospital network.
 */

export class AudioPipeline {
  private asr: WhisperASR;
  private diarizer: SpeakerDiarizer;
  private config: PipelineConfig;
  private isRecording = false;
  private audioBuffer: Buffer = Buffer.alloc(0);
  private results: DiarizedSegment[] = [];

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = {
      asr: {
        model: config.asr?.model ?? 'large-v3',
        language: config.asr?.language ?? 'en',
        device: config.asr?.device ?? 'cuda',
        sampleRate: config.asr?.sampleRate ?? 16000,
        wordTimestamps: config.asr?.wordTimestamps ?? true,
      },
      enableDiarization: config.enableDiarization ?? true,
      enableNoiseReduction: config.enableNoiseReduction ?? true,
      silenceThresholdDb: config.silenceThresholdDb ?? -40,
      minSpeechDurationMs: config.minSpeechDurationMs ?? 500,
      bufferSeconds: config.bufferSeconds ?? 10,
    };

    this.asr = new WhisperASR(this.config.asr);
    this.diarizer = new SpeakerDiarizer();
  }

  /** Check if ASR infrastructure is available */
  async checkHealth(): Promise<{
    asrAvailable: boolean;
    asrModel: string;
    asrDevice: string;
    asrLatency: number;
  }> {
    const health = await this.asr.healthCheck();
    return {
      asrAvailable: health.available,
      asrModel: health.model,
      asrDevice: health.device,
      asrLatency: health.latencyMs,
    };
  }

  /** Start recording session */
  startRecording(): void {
    this.isRecording = true;
    this.audioBuffer = Buffer.alloc(0);
    this.results = [];
  }

  /** Add audio chunk from microphone */
  addAudioChunk(chunk: Buffer): void {
    if (!this.isRecording) throw new Error('Not recording');
    this.audioBuffer = Buffer.concat([this.audioBuffer, chunk]);
  }

  /**
   * Process accumulated audio buffer.
   * Call periodically (e.g., every 10 seconds) for near-real-time results.
   */
  async processBuffer(): Promise<DiarizedSegment[]> {
    if (this.audioBuffer.length === 0) return [];

    const audio = this.audioBuffer;
    this.audioBuffer = Buffer.alloc(0);

    // 1. ASR: audio → text
    const transcription = await this.asr.transcribe(audio);

    if (!transcription.text.trim()) return [];

    // 2. Diarization: identify speakers
    let diarizedSegments: DiarizedSegment[];

    if (this.config.enableDiarization) {
      const diarization = await this.diarizer.diarize(audio);
      diarizedSegments = this.diarizer.mergeWithTranscription(
        transcription.segments,
        diarization
      );
    } else {
      diarizedSegments = transcription.segments.map((s) => ({
        speaker: 'unknown',
        start: s.start,
        end: s.end,
        text: s.text,
        confidence: s.confidence,
      }));
    }

    this.results.push(...diarizedSegments);
    return diarizedSegments;
  }

  /** Stop recording and get final results */
  async stopRecording(): Promise<{
    segments: DiarizedSegment[];
    totalDuration: number;
    speakerLabels: Map<string, string>;
  }> {
    this.isRecording = false;

    // Process any remaining audio
    if (this.audioBuffer.length > 0) {
      await this.processBuffer();
    }

    // Auto-classify speakers
    const speakerLabels = this.diarizer.classifySpeakers(this.results);

    // Apply speaker labels to segments
    const labeledSegments = this.results.map((seg) => ({
      ...seg,
      speaker: speakerLabels.get(seg.speaker) ?? seg.speaker,
    }));

    const totalDuration = labeledSegments.reduce(
      (max, s) => Math.max(max, s.end),
      0
    );

    return { segments: labeledSegments, totalDuration, speakerLabels };
  }

  /** Get current results (while still recording) */
  getCurrentResults(): DiarizedSegment[] {
    return [...this.results];
  }

  /** Get recording status */
  getStatus(): {
    isRecording: boolean;
    bufferedAudioBytes: number;
    segmentsProcessed: number;
    totalSpeakingTime: number;
  } {
    return {
      isRecording: this.isRecording,
      bufferedAudioBytes: this.audioBuffer.length,
      segmentsProcessed: this.results.length,
      totalSpeakingTime: this.results.reduce((sum, s) => sum + (s.end - s.start), 0),
    };
  }
}
