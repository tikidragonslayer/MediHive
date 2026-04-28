import Anthropic from '@anthropic-ai/sdk';
import { TranscriptSegment, ClinicalEntity, SOAPNote } from './types';

/** Patient context summary from FHIR records */
interface PatientSummary {
  demographics?: { name: string; gender: string; birthDate: string; mrn: string };
  activeConditions: Array<{ code: string; display: string; onset: string }>;
  currentMedications: Array<{ name: string; dosage: string }>;
  allergies: Array<{ substance: string; severity: string }>;
  latestVitals: Record<string, { value: string; date: string }>;
  recentLabs: Array<{ name: string; value: string; date: string }>;
}

/**
 * SOAPGenerator — Uses Claude API to generate structured SOAP notes
 * from clinical conversation transcripts with patient context.
 *
 * The note is always a DRAFT until the clinician reviews and signs.
 * This is a legal requirement — AI-generated notes cannot be finalized without attestation.
 */
export class SOAPGenerator {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  /** Generate a SOAP note from transcript + patient context */
  async generateSOAPNote(
    transcript: TranscriptSegment[],
    entities: ClinicalEntity[],
    patientContext?: PatientSummary
  ): Promise<SOAPNote> {
    const transcriptText = transcript
      .map((s) => `[${s.speaker.toUpperCase()}]: ${s.text}`)
      .join('\n');

    const entitiesText = entities
      .map((e) => `- ${e.type}: ${e.text}${e.normalized ? ` (${e.normalized})` : ''}${e.code ? ` [${e.codeSystem}:${e.code}]` : ''}`)
      .join('\n');

    const contextText = patientContext
      ? this.formatPatientContext(patientContext)
      : 'No prior patient history available.';

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `You are a medical documentation specialist generating a SOAP note from a clinical encounter transcript.

PATIENT CONTEXT (from medical records):
${contextText}

CLINICAL ENTITIES EXTRACTED:
${entitiesText}

TRANSCRIPT:
${transcriptText}

Generate a structured SOAP note in JSON format with the following fields:
- subjective: Patient's reported symptoms, history of present illness, review of systems
- objective: Physical exam findings, vitals, observable data mentioned
- assessment: Clinical assessment, differential diagnosis, working diagnosis
- plan: Treatment plan, orders, follow-up
- icdCodes: Array of {code, display} for relevant ICD-10 codes
- cptCodes: Array of {code, display} for relevant CPT procedure codes
- medicationChanges: Array of {action: "start"|"stop"|"adjust", medication, details}
- followUp: Follow-up instructions if mentioned

Be clinically accurate. Only include information explicitly stated or clearly implied in the transcript. Do not hallucinate findings not discussed.

Respond with ONLY the JSON object, no markdown fences.`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Robust JSON parsing with fallback
    let parsed: Record<string, unknown>;
    try {
      // Strip markdown fences if Claude includes them despite instructions
      const cleaned = content.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON parse fails, attempt to extract structured sections from freetext
      parsed = this.extractSOAPFromFreetext(content.text);
    }

    // Validate required fields are non-empty strings
    const subjective = typeof parsed.subjective === 'string' ? parsed.subjective : '';
    const objective = typeof parsed.objective === 'string' ? parsed.objective : '';
    const assessment = typeof parsed.assessment === 'string' ? parsed.assessment : '';
    const plan = typeof parsed.plan === 'string' ? parsed.plan : '';

    if (!subjective && !objective && !assessment && !plan) {
      throw new Error('SOAP note generation failed: all sections are empty. Raw response logged for review.');
    }

    return {
      subjective,
      objective,
      assessment,
      plan,
      icdCodes: Array.isArray(parsed.icdCodes) ? parsed.icdCodes as Array<{ code: string; display: string }> : [],
      cptCodes: Array.isArray(parsed.cptCodes) ? parsed.cptCodes as Array<{ code: string; display: string }> : [],
      medicationChanges: Array.isArray(parsed.medicationChanges) ? parsed.medicationChanges as Array<{ action: 'start' | 'stop' | 'adjust'; medication: string; details: string }> : [],
      followUp: typeof parsed.followUp === 'string' ? parsed.followUp : undefined,
      generatedAt: new Date().toISOString(),
      reviewStatus: 'draft',
      editHistory: [],
    };
  }

  /** Fallback: extract SOAP sections from freetext when JSON parse fails */
  private extractSOAPFromFreetext(text: string): Record<string, unknown> {
    const sections: Record<string, string> = {};
    const markers = [
      { key: 'subjective', patterns: ['SUBJECTIVE:', 'S:', 'Subjective:'] },
      { key: 'objective', patterns: ['OBJECTIVE:', 'O:', 'Objective:'] },
      { key: 'assessment', patterns: ['ASSESSMENT:', 'A:', 'Assessment:'] },
      { key: 'plan', patterns: ['PLAN:', 'P:', 'Plan:'] },
    ];

    for (let i = 0; i < markers.length; i++) {
      const { key, patterns } = markers[i];
      for (const pattern of patterns) {
        const idx = text.indexOf(pattern);
        if (idx === -1) continue;

        const start = idx + pattern.length;
        // Find next section or end of text
        let end = text.length;
        for (let j = i + 1; j < markers.length; j++) {
          for (const nextPattern of markers[j].patterns) {
            const nextIdx = text.indexOf(nextPattern, start);
            if (nextIdx !== -1 && nextIdx < end) end = nextIdx;
          }
        }
        sections[key] = text.substring(start, end).trim();
        break;
      }
    }

    return sections;
  }

  /** Format patient context for the prompt */
  private formatPatientContext(summary: PatientSummary): string {
    const parts: string[] = [];

    if (summary.demographics) {
      parts.push(
        `Patient: ${summary.demographics.name}, ${summary.demographics.gender}, DOB: ${summary.demographics.birthDate}`
      );
    }

    if (summary.activeConditions.length > 0) {
      parts.push(
        'Active Conditions:\n' +
          summary.activeConditions
            .map((c) => `  - ${c.display} (${c.code}) since ${c.onset}`)
            .join('\n')
      );
    }

    if (summary.currentMedications.length > 0) {
      parts.push(
        'Current Medications:\n' +
          summary.currentMedications
            .map((m) => `  - ${m.name}: ${m.dosage}`)
            .join('\n')
      );
    }

    if (summary.allergies.length > 0) {
      parts.push(
        'Allergies:\n' +
          summary.allergies
            .map((a) => `  - ${a.substance} (${a.severity})`)
            .join('\n')
      );
    }

    const vitalEntries = Object.entries(summary.latestVitals);
    if (vitalEntries.length > 0) {
      parts.push(
        'Latest Vitals:\n' +
          vitalEntries
            .map(([key, v]) => `  - ${key}: ${v.value} (${v.date})`)
            .join('\n')
      );
    }

    if (summary.recentLabs.length > 0) {
      parts.push(
        'Recent Labs:\n' +
          summary.recentLabs
            .map((l) => `  - ${l.name}: ${l.value} (${l.date})`)
            .join('\n')
      );
    }

    return parts.join('\n\n');
  }
}
