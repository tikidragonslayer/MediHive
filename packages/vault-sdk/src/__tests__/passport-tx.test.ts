/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Serialization correctness tests for the passport instruction
 * builders. We pin the Anchor discriminator (first 8 bytes of
 * sha256("global:<method_name>")) and the Borsh arg layout so any
 * future change that would break compatibility with the deployed
 * Anchor program fails here BEFORE constructing a real transaction.
 *
 * NOTE: These do NOT exercise a real Solana validator. End-to-end
 * devnet smoke testing requires:
 *   - solana-test-validator running locally, OR
 *   - a funded devnet wallet + Anchor programs deployed to devnet
 * Neither is checked in or runnable from CI today; that's tracked as
 * separate work. The serialization layer is what these tests cover.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { Connection } from '@solana/web3.js';
import { PatientPassportSDK } from '../passport';
import { PassportStatus } from '../types';

// Use a fake connection — we never call .sendRawTransaction in these
// tests, only the synchronous build methods.
const FAKE_CONNECTION = {
  getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 0 }),
  sendRawTransaction: async () => 'fake-sig',
} as unknown as Connection;

const PROGRAM_ID = new PublicKey('4qcKgX68Yss43mR9XbuM2Ea9KhC3jvVRy3MJJKKm8jKn');

const sdk = new PatientPassportSDK(FAKE_CONNECTION, PROGRAM_ID);

const make32 = (seed: number): Uint8Array =>
  new Uint8Array(Array.from({ length: 32 }, (_, i) => (seed + i) & 0xff));

describe('PatientPassportSDK.buildCreatePassportIx — discriminator + layout', () => {
  it('uses the canonical Anchor discriminator for create_passport', () => {
    const expected = createHash('sha256').update('global:create_passport').digest().subarray(0, 8);
    const authority = Keypair.generate().publicKey;
    const ix = sdk.buildCreatePassportIx({
      authority,
      mrnHash: make32(0x10),
      identityHash: make32(0x20),
      publicEncryptionKey: make32(0x30),
      recoveryThreshold: 1,
      guardians: [Keypair.generate().publicKey],
      emergencyHospitalShard: false,
    });
    expect(ix.data.subarray(0, 8).equals(Buffer.from(expected))).toBe(true);
  });

  it('emits the Borsh layout in the documented order', () => {
    const authority = Keypair.generate().publicKey;
    const guardian = Keypair.generate().publicKey;
    const mrn = make32(0xaa);
    const id = make32(0xbb);
    const pek = make32(0xcc);

    const ix = sdk.buildCreatePassportIx({
      authority,
      mrnHash: mrn,
      identityHash: id,
      publicEncryptionKey: pek,
      recoveryThreshold: 1,
      guardians: [guardian],
      emergencyHospitalShard: true,
    });

    // Skip 8-byte discriminator.
    let off = 8;
    expect(ix.data.subarray(off, off + 32).equals(Buffer.from(mrn))).toBe(true);
    off += 32;
    expect(ix.data.subarray(off, off + 32).equals(Buffer.from(id))).toBe(true);
    off += 32;
    expect(ix.data.subarray(off, off + 32).equals(Buffer.from(pek))).toBe(true);
    off += 32;
    expect(ix.data[off]).toBe(1); // recoveryThreshold
    off += 1;
    expect(ix.data.readUInt32LE(off)).toBe(1); // guardians_len
    off += 4;
    expect(ix.data.subarray(off, off + 32).equals(guardian.toBuffer())).toBe(true);
    off += 32;
    expect(ix.data[off]).toBe(1); // emergencyHospitalShard = true
    off += 1;
    expect(ix.data.length).toBe(off);
  });

  it('passes accounts in the documented order: passportPda, authority, systemProgram', () => {
    const authority = Keypair.generate().publicKey;
    const ix = sdk.buildCreatePassportIx({
      authority,
      mrnHash: make32(1),
      identityHash: make32(2),
      publicEncryptionKey: make32(3),
      recoveryThreshold: 1,
      guardians: [Keypair.generate().publicKey],
      emergencyHospitalShard: false,
    });
    expect(ix.keys.length).toBe(3);

    // 0: passport PDA — writable, not signer
    expect(ix.keys[0].isSigner).toBe(false);
    expect(ix.keys[0].isWritable).toBe(true);
    const [expectedPda] = sdk.getPassportPDA(authority);
    expect(ix.keys[0].pubkey.equals(expectedPda)).toBe(true);

    // 1: authority — signer + writable (pays rent)
    expect(ix.keys[1].isSigner).toBe(true);
    expect(ix.keys[1].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.equals(authority)).toBe(true);

    // 2: system program — readonly
    expect(ix.keys[2].isSigner).toBe(false);
    expect(ix.keys[2].isWritable).toBe(false);
    expect(ix.keys[2].pubkey.equals(new PublicKey('11111111111111111111111111111111'))).toBe(true);
  });

  it('rejects non-32-byte hashes', () => {
    const authority = Keypair.generate().publicKey;
    expect(() =>
      sdk.buildCreatePassportIx({
        authority,
        mrnHash: new Uint8Array(31), // wrong length
        identityHash: make32(2),
        publicEncryptionKey: make32(3),
        recoveryThreshold: 1,
        guardians: [Keypair.generate().publicKey],
        emergencyHospitalShard: false,
      }),
    ).toThrow(/mrnHash/);
  });

  it('rejects guardians shorter than recoveryThreshold', () => {
    const authority = Keypair.generate().publicKey;
    expect(() =>
      sdk.buildCreatePassportIx({
        authority,
        mrnHash: make32(1),
        identityHash: make32(2),
        publicEncryptionKey: make32(3),
        recoveryThreshold: 5,
        guardians: [Keypair.generate().publicKey], // only 1
        emergencyHospitalShard: false,
      }),
    ).toThrow(/recoveryThreshold/);
  });

  it('rejects more than 10 guardians', () => {
    const authority = Keypair.generate().publicKey;
    expect(() =>
      sdk.buildCreatePassportIx({
        authority,
        mrnHash: make32(1),
        identityHash: make32(2),
        publicEncryptionKey: make32(3),
        recoveryThreshold: 1,
        guardians: Array.from({ length: 11 }, () => Keypair.generate().publicKey),
        emergencyHospitalShard: false,
      }),
    ).toThrow(/cap is 10/);
  });

  it('rejects recoveryThreshold outside 1..10', () => {
    const authority = Keypair.generate().publicKey;
    expect(() =>
      sdk.buildCreatePassportIx({
        authority,
        mrnHash: make32(1),
        identityHash: make32(2),
        publicEncryptionKey: make32(3),
        recoveryThreshold: 0,
        guardians: [Keypair.generate().publicKey],
        emergencyHospitalShard: false,
      }),
    ).toThrow(/recoveryThreshold/);

    expect(() =>
      sdk.buildCreatePassportIx({
        authority,
        mrnHash: make32(1),
        identityHash: make32(2),
        publicEncryptionKey: make32(3),
        recoveryThreshold: 11,
        guardians: Array.from({ length: 11 }, () => Keypair.generate().publicKey),
        emergencyHospitalShard: false,
      }),
    ).toThrow(/recoveryThreshold/);
  });
});

describe('PatientPassportSDK.buildSetPassportStatusIx', () => {
  it('uses the canonical discriminator and emits {disc, status}', () => {
    const expected = createHash('sha256').update('global:set_passport_status').digest().subarray(0, 8);
    const authority = Keypair.generate().publicKey;

    const ix = sdk.buildSetPassportStatusIx({ authority, status: PassportStatus.Suspended });
    expect(ix.data.subarray(0, 8).equals(Buffer.from(expected))).toBe(true);
    expect(ix.data.length).toBe(9);
    expect(ix.data[8]).toBe(PassportStatus.Suspended);
  });

  it('passes accounts in the documented order: passportPda, authority(signer)', () => {
    const authority = Keypair.generate().publicKey;
    const ix = sdk.buildSetPassportStatusIx({ authority, status: PassportStatus.Revoked });
    expect(ix.keys.length).toBe(2);
    const [expectedPda] = sdk.getPassportPDA(authority);
    expect(ix.keys[0].pubkey.equals(expectedPda)).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].isSigner).toBe(true);
    expect(ix.keys[1].pubkey.equals(authority)).toBe(true);
  });

  it('rejects out-of-range status values', () => {
    const authority = Keypair.generate().publicKey;
    expect(() =>
      sdk.buildSetPassportStatusIx({ authority, status: 99 as PassportStatus }),
    ).toThrow(/status/);
  });
});
