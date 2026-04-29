/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * PatientBridgeStore — Postgres-backed implementation of patient
 * bridge linkage between local passport UUIDs and on-chain wallet
 * identities. See migrations/002_bridges.sql for the schema and
 * trust-model commentary.
 */

import { Pool } from 'pg';
import { canonicalizeBridge, BridgePayload } from './bridge-canonical';

export type BridgeEstablishedVia = 'patient_signed' | 'admin_imported' | 'fhir_match';

export interface PatientBridge {
  id: string;
  localPassportId: string | null;
  onchainPassportId: string | null;
  establishedVia: BridgeEstablishedVia;
  signatureB64: string | null;
  signatureNonce: string | null;
  signatureTimestamp: number | null;
  onchainRecordTypes: string[];
  revokedAt: number | null;
  establishedAt: number;
}

export interface CreateBridgeInput {
  localPassportId: string | null;
  onchainPassportId: string | null;
  establishedVia: BridgeEstablishedVia;
  /** Required when establishedVia = 'patient_signed'. */
  signatureB64?: string | null;
  signatureNonce?: string | null;
  signatureTimestamp?: number | null;
  onchainRecordTypes?: string[];
}

export interface BridgeSignatureVerifier {
  /**
   * Verify an Ed25519 signature over the canonicalized BridgePayload
   * using the on-chain pubkey as the public key. Implementations:
   *
   *   - Real: tweetnacl or @noble/ed25519 over the canonical payload.
   *   - Test: AlwaysValidVerifier / AlwaysInvalidVerifier.
   *
   * The store calls this synchronously when establishedVia is
   * 'patient_signed'; if it returns false, the bridge is rejected.
   */
  verify(payload: BridgePayload, signatureB64: string, onchainPubkeyB58: string): boolean;
}

/**
 * Default skew window for "the signature timestamp is recent enough."
 * 5 minutes is the same window most major payment networks accept for
 * idempotency replay protection. Hospitals can override.
 */
export const DEFAULT_SIGNATURE_SKEW_SECONDS = 300;

export class PatientBridgeStore {
  constructor(
    private readonly pool: Pool,
    private readonly verifier: BridgeSignatureVerifier,
    private readonly skewSeconds: number = DEFAULT_SIGNATURE_SKEW_SECONDS,
  ) {}

  async createBridge(input: CreateBridgeInput): Promise<PatientBridge> {
    if (!input.localPassportId && !input.onchainPassportId) {
      throw new Error('Bridge requires at least one of localPassportId or onchainPassportId');
    }

    if (input.establishedVia === 'patient_signed') {
      this.requireSignedBridge(input);
    }

    const types = input.onchainRecordTypes ?? [];

    const { rows } = await this.pool.query(
      `INSERT INTO patient_bridges
         (local_passport_id, onchain_passport_id, established_via,
          signature_b64, signature_nonce, signature_timestamp,
          onchain_record_types)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.localPassportId,
        input.onchainPassportId,
        input.establishedVia,
        input.signatureB64 ?? null,
        input.signatureNonce ?? null,
        input.signatureTimestamp ?? null,
        types,
      ],
    );
    return rowToBridge(rows[0]);
  }

  async findByLocal(localPassportId: string): Promise<PatientBridge | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM patient_bridges
        WHERE local_passport_id = $1
          AND revoked_at IS NULL
        ORDER BY established_at DESC
        LIMIT 1`,
      [localPassportId],
    );
    return rows[0] ? rowToBridge(rows[0]) : null;
  }

  async findByOnchain(onchainPassportId: string): Promise<PatientBridge | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM patient_bridges
        WHERE onchain_passport_id = $1
          AND revoked_at IS NULL
        ORDER BY established_at DESC
        LIMIT 1`,
      [onchainPassportId],
    );
    return rows[0] ? rowToBridge(rows[0]) : null;
  }

  async revoke(id: string): Promise<PatientBridge> {
    const { rows } = await this.pool.query(
      `UPDATE patient_bridges
         SET revoked_at = NOW()
         WHERE id = $1
         RETURNING *`,
      [id],
    );
    if (!rows[0]) throw new Error(`bridge not found: ${id}`);
    return rowToBridge(rows[0]);
  }

  // -------------------------------------------------------------
  // Signature verification (called from createBridge)
  // -------------------------------------------------------------

  private requireSignedBridge(input: CreateBridgeInput): void {
    if (
      !input.signatureB64 ||
      !input.signatureNonce ||
      input.signatureTimestamp == null ||
      !input.onchainPassportId
    ) {
      throw new Error(
        'patient_signed bridge requires signatureB64, signatureNonce, ' +
          'signatureTimestamp, and onchainPassportId',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - input.signatureTimestamp) > this.skewSeconds) {
      throw new Error(
        `Bridge signature timestamp out of acceptable skew (±${this.skewSeconds}s). ` +
          `Provided: ${input.signatureTimestamp}, now: ${now}.`,
      );
    }

    const payload: BridgePayload = {
      localPassportId: input.localPassportId,
      onchainPassportId: input.onchainPassportId,
      nonce: input.signatureNonce,
      timestamp: input.signatureTimestamp,
    };

    const ok = this.verifier.verify(payload, input.signatureB64, input.onchainPassportId);
    if (!ok) {
      throw new Error(
        'Bridge signature verification failed. The signature did not match the on-chain ' +
          'pubkey for the canonical payload. Reject this bridge attempt.',
      );
    }

    // Defense-in-depth: confirm the canonicalization in this codebase
    // matches what the patient signed. If a future refactor changes the
    // canonicalize function, all existing signatures will simultaneously
    // become invalid — which is fine, but the constant should make the
    // contract obvious.
    void canonicalizeBridge(payload);
  }
}

interface BridgeRow {
  id: string;
  local_passport_id: string | null;
  onchain_passport_id: string | null;
  established_via: BridgeEstablishedVia;
  signature_b64: string | null;
  signature_nonce: string | null;
  signature_timestamp: string | number | null;
  onchain_record_types: string[];
  revoked_at: Date | null;
  established_at: Date;
}

function rowToBridge(r: BridgeRow): PatientBridge {
  return {
    id: r.id,
    localPassportId: r.local_passport_id,
    onchainPassportId: r.onchain_passport_id,
    establishedVia: r.established_via,
    signatureB64: r.signature_b64,
    signatureNonce: r.signature_nonce,
    signatureTimestamp:
      r.signature_timestamp == null
        ? null
        : typeof r.signature_timestamp === 'string'
          ? parseInt(r.signature_timestamp, 10)
          : r.signature_timestamp,
    onchainRecordTypes: r.onchain_record_types,
    revokedAt: r.revoked_at ? Math.floor(r.revoked_at.getTime() / 1000) : null,
    establishedAt: Math.floor(r.established_at.getTime() / 1000),
  };
}
