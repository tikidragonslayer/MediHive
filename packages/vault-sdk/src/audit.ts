import { Connection, PublicKey } from '@solana/web3.js';
import { AuditEntry, AuditAction } from './types';

export class AuditLoggerSDK {
  constructor(
    private connection: Connection,
    private programId: PublicKey
  ) {}

  /** Fetch all audit entries for a patient */
  async getPatientAuditTrail(targetPatient: PublicKey): Promise<AuditEntry[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        // target_patient is at offset 8 (discriminator) + 32 (actor) + 1 (action)
        { memcmp: { offset: 41, bytes: targetPatient.toBase58() } },
      ],
    });

    return accounts
      .map((a) => this.decodeAuditEntry(a.account.data))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Fetch audit entries by actor (e.g., a specific clinician) */
  async getActorAuditTrail(actor: PublicKey): Promise<AuditEntry[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 8, bytes: actor.toBase58() } },
      ],
    });

    return accounts
      .map((a) => this.decodeAuditEntry(a.account.data))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Generate a HIPAA compliance report for a patient */
  async generateComplianceReport(
    targetPatient: PublicKey
  ): Promise<{ entries: AuditEntry[]; summary: ComplianceReportSummary }> {
    const entries = await this.getPatientAuditTrail(targetPatient);

    const summary: ComplianceReportSummary = {
      totalAccesses: entries.length,
      uniqueActors: new Set(entries.map((e) => e.actor.toBase58())).size,
      emergencyAccesses: entries.filter(
        (e) => e.action === AuditAction.EmergencyAccess || e.action === AuditAction.BreakGlass
      ).length,
      grantChanges: entries.filter(
        (e) => e.action === AuditAction.Grant || e.action === AuditAction.Revoke
      ).length,
      consentChanges: entries.filter((e) => e.action === AuditAction.ConsentChange).length,
      firstAccess: entries.length > 0 ? entries[0].timestamp : 0,
      lastAccess: entries.length > 0 ? entries[entries.length - 1].timestamp : 0,
    };

    return { entries, summary };
  }

  private decodeAuditEntry(data: Buffer): AuditEntry {
    let offset = 8;

    const actor = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const action = data[offset] as AuditAction;
    offset += 1;

    const targetPatient = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const hasTargetRecord = data[offset] === 1;
    offset += 1;
    const targetRecord = hasTargetRecord
      ? new PublicKey(data.subarray(offset, offset + 32))
      : null;
    if (hasTargetRecord) offset += 32;

    const timestamp = Number(data.readBigInt64LE(offset));
    offset += 8;

    const ipHash = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const deviceHash = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const metadataLen = data.readUInt32LE(offset);
    offset += 4;
    const metadata = data.subarray(offset, offset + metadataLen).toString('utf8');

    const bump = data[offset + metadataLen];

    return {
      actor,
      action,
      targetPatient,
      targetRecord,
      timestamp,
      ipHash,
      deviceHash,
      metadata,
      bump,
    };
  }
}

interface ComplianceReportSummary {
  totalAccesses: number;
  uniqueActors: number;
  emergencyAccesses: number;
  grantChanges: number;
  consentChanges: number;
  firstAccess: number;
  lastAccess: number;
}
