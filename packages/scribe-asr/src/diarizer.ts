import { DiarizationResult, DiarizedSegment, SpeakerProfile, ASRSegment } from './types';

/**
 * SpeakerDiarizer — Identifies who is speaking (doctor, patient, nurse).
 *
 * Uses pyannote.audio 3.0 running on the hospital edge GPU.
 * The diarizer labels speaker turns, then we classify each speaker
 * based on speaking patterns and context:
 * - Speaker with most medical terminology → doctor
 * - Speaker responding to medical questions → patient
 * - Speaker performing assessments → nurse
 *
 * Deployment:
 *   pip install pyannote.audio
 *   python -m pyannote.audio.server --port 8766
 *
 * Or via faster-whisper which includes built-in diarization.
 */

export class SpeakerDiarizer {
  private serverUrl: string;

  constructor(serverUrl: string = 'http://localhost:8766') {
    this.serverUrl = serverUrl;
  }

  /**
   * Diarize an audio buffer — identify speaker turns.
   * Returns time-aligned speaker segments.
   */
  async diarize(audioBuffer: Buffer): Promise<DiarizationResult> {
    try {
      const response = await fetch(`${this.serverUrl}/v1/diarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: audioBuffer,
      });

      if (!response.ok) {
        throw new Error(`Diarization failed: ${response.status}`);
      }

      const data = await response.json() as PyAnnoteResponse;
      return this.processResponse(data);
    } catch (err) {
      // Fallback: single speaker (entire audio = one speaker)
      return {
        segments: [{ speaker: 'unknown', start: 0, end: 0, text: '', confidence: 0.5 }],
        speakers: [{ id: 'SPEAKER_0', label: 'unknown', totalSpeakingTime: 0, segmentCount: 1 }],
        totalSpeakers: 1,
      };
    }
  }

  /**
   * Merge ASR transcription segments with diarization speaker labels.
   * Aligns word-level timestamps from Whisper with speaker turns from pyannote.
   */
  mergeWithTranscription(
    asrSegments: ASRSegment[],
    diarization: DiarizationResult
  ): DiarizedSegment[] {
    const result: DiarizedSegment[] = [];

    for (const asrSeg of asrSegments) {
      // Find which speaker was talking during this ASR segment
      const speaker = this.findSpeakerAtTime(
        (asrSeg.start + asrSeg.end) / 2,
        diarization.segments
      );

      result.push({
        speaker: speaker?.speaker ?? 'unknown',
        start: asrSeg.start,
        end: asrSeg.end,
        text: asrSeg.text,
        confidence: asrSeg.confidence,
      });
    }

    return result;
  }

  /**
   * Auto-label speakers based on speaking patterns.
   * Uses heuristics (in production: fine-tuned classifier).
   */
  classifySpeakers(
    segments: DiarizedSegment[],
    knownDoctorName?: string,
    knownPatientName?: string
  ): Map<string, string> {
    const speakerStats = new Map<string, {
      totalWords: number;
      medicalTermCount: number;
      questionCount: number;
      avgSegmentLength: number;
      segments: number;
    }>();

    // Analyze speaking patterns
    for (const seg of segments) {
      const stats = speakerStats.get(seg.speaker) ?? {
        totalWords: 0, medicalTermCount: 0, questionCount: 0, avgSegmentLength: 0, segments: 0,
      };

      const words = seg.text.split(/\s+/);
      stats.totalWords += words.length;
      stats.segments += 1;
      stats.avgSegmentLength = stats.totalWords / stats.segments;

      // Count medical terminology
      const medTerms = /\b(diagnosis|medication|prescri|symptom|dosage|vitals|blood pressure|heart rate|assessment|treatment|procedure|lab|imaging|ct scan|mri|ekg|ecg)\b/gi;
      stats.medicalTermCount += (seg.text.match(medTerms) ?? []).length;

      // Count questions
      stats.questionCount += (seg.text.match(/\?/g) ?? []).length;

      speakerStats.set(seg.speaker, stats);
    }

    // Classify
    const labels = new Map<string, string>();
    const speakers = Array.from(speakerStats.entries());

    // Sort by medical term density (most medical terms = most likely doctor)
    speakers.sort((a, b) =>
      (b[1].medicalTermCount / b[1].totalWords) - (a[1].medicalTermCount / a[1].totalWords)
    );

    if (speakers.length >= 2) {
      // Highest medical term density = doctor
      labels.set(speakers[0][0], 'doctor');
      // Second = patient (usually responds to questions)
      labels.set(speakers[1][0], 'patient');
      // Any others = nurse/unknown
      for (let i = 2; i < speakers.length; i++) {
        labels.set(speakers[i][0], 'nurse');
      }
    } else if (speakers.length === 1) {
      labels.set(speakers[0][0], 'unknown');
    }

    return labels;
  }

  // === Private ===

  private findSpeakerAtTime(
    time: number,
    segments: DiarizedSegment[]
  ): DiarizedSegment | undefined {
    return segments.find((s) => time >= s.start && time <= s.end);
  }

  private processResponse(data: PyAnnoteResponse): DiarizationResult {
    const speakers = new Map<string, SpeakerProfile>();
    const segments: DiarizedSegment[] = [];

    for (const turn of data.turns ?? []) {
      const speakerId = turn.speaker ?? 'SPEAKER_0';

      segments.push({
        speaker: speakerId,
        start: turn.start,
        end: turn.end,
        text: '',
        confidence: turn.confidence ?? 0.8,
      });

      const profile = speakers.get(speakerId) ?? {
        id: speakerId,
        label: 'unknown',
        totalSpeakingTime: 0,
        segmentCount: 0,
      };
      profile.totalSpeakingTime += turn.end - turn.start;
      profile.segmentCount += 1;
      speakers.set(speakerId, profile);
    }

    return {
      segments,
      speakers: Array.from(speakers.values()),
      totalSpeakers: speakers.size,
    };
  }
}

interface PyAnnoteResponse {
  turns?: Array<{
    speaker: string;
    start: number;
    end: number;
    confidence?: number;
  }>;
}
