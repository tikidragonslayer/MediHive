import { ASRConfig, TranscriptionResult, ASRSegment } from './types';

/**
 * WhisperASR — On-premise speech-to-text using OpenAI Whisper.
 *
 * Deployment options (all on-premise, HIPAA compliant):
 *
 * 1. faster-whisper (Python, CTranslate2 backend)
 *    - 4x faster than original Whisper
 *    - Runs on NVIDIA GPU (CUDA) or CPU
 *    - Exposes REST API for this TypeScript client
 *    - Recommended for production
 *
 * 2. whisper.cpp (C++, GGML backend)
 *    - Runs on CPU efficiently (no GPU needed)
 *    - Good for edge devices / ARM servers
 *    - Server mode: --server flag
 *
 * 3. Whisper JAX (Google TPU/GPU)
 *    - Fastest option on GPU
 *    - 70x faster than original on A100
 *
 * The TypeScript client connects to whichever backend is deployed.
 * Audio NEVER leaves the hospital network.
 *
 * Setup (faster-whisper):
 *   pip install faster-whisper
 *   python -m faster_whisper.server --model large-v3 --device cuda --port 8765
 *
 * Setup (whisper.cpp):
 *   ./server -m models/ggml-large-v3.bin --port 8765
 */

export class WhisperASR {
  private config: ASRConfig;
  private serverUrl: string;

  constructor(config: Partial<ASRConfig> = {}) {
    this.config = {
      model: config.model ?? 'large-v3',
      language: config.language ?? 'en',
      device: config.device ?? 'cuda',
      sampleRate: config.sampleRate ?? 16000,
      wordTimestamps: config.wordTimestamps ?? true,
      serverUrl: config.serverUrl,
    };
    this.serverUrl = config.serverUrl ?? 'http://localhost:8765';
  }

  /**
   * Transcribe an audio buffer (WAV/PCM format).
   * Sends audio to the local Whisper server for processing.
   */
  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    const startTime = Date.now();

    // Build multipart form data
    const boundary = `----MediHive${Date.now()}`;
    const formData = this.buildMultipart(audioBuffer, boundary);

    const response = await fetch(`${this.serverUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Whisper ASR failed: ${response.status} — ${error}`);
    }

    const result = await response.json() as WhisperResponse;
    const processingTime = Date.now() - startTime;

    return {
      text: result.text ?? '',
      segments: (result.segments ?? []).map((s, i) => ({
        id: i,
        start: s.start ?? 0,
        end: s.end ?? 0,
        text: s.text ?? '',
        confidence: s.avg_logprob ? Math.exp(s.avg_logprob) : 0.9,
        words: s.words?.map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: w.probability ?? 0.9,
        })),
      })),
      language: result.language ?? this.config.language,
      duration: result.duration ?? 0,
      processingTime,
    };
  }

  /**
   * Stream transcription — processes audio in chunks.
   * Returns partial results as they become available.
   */
  async *transcribeStream(
    audioChunks: AsyncIterable<Buffer>,
    chunkDurationMs: number = 5000
  ): AsyncGenerator<{ partial: string; segments: ASRSegment[] }> {
    let buffer = Buffer.alloc(0);
    const bytesPerChunk = Math.floor(
      (this.config.sampleRate * 2 * chunkDurationMs) / 1000 // 16-bit mono PCM
    );

    for await (const chunk of audioChunks) {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length >= bytesPerChunk) {
        const result = await this.transcribe(buffer);
        buffer = Buffer.alloc(0);

        yield {
          partial: result.text,
          segments: result.segments,
        };
      }
    }

    // Process remaining audio
    if (buffer.length > 0) {
      const result = await this.transcribe(buffer);
      yield { partial: result.text, segments: result.segments };
    }
  }

  /**
   * Check if the Whisper server is available and responsive.
   */
  async healthCheck(): Promise<{
    available: boolean;
    model: string;
    device: string;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const latency = Date.now() - start;

      if (!response.ok) {
        return { available: false, model: '', device: '', latencyMs: latency };
      }

      const data = await response.json() as { model?: string; device?: string };
      return {
        available: true,
        model: data.model ?? this.config.model,
        device: data.device ?? this.config.device,
        latencyMs: latency,
      };
    } catch {
      return { available: false, model: '', device: '', latencyMs: Date.now() - start };
    }
  }

  // === Private ===

  private buildMultipart(audioBuffer: Buffer, boundary: string): Buffer {
    const parts: Buffer[] = [];

    // Audio file part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));

    // Model parameter
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${this.config.model}\r\n`
    ));

    // Language parameter
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${this.config.language}\r\n`
    ));

    // Response format
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
    ));

    // Word timestamps
    if (this.config.wordTimestamps) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`
      ));
    }

    // Closing boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    return Buffer.concat(parts);
  }
}

// Whisper API response types
interface WhisperResponse {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    avg_logprob?: number;
    words?: Array<{
      word: string;
      start: number;
      end: number;
      probability?: number;
    }>;
  }>;
  language?: string;
  duration?: number;
}
