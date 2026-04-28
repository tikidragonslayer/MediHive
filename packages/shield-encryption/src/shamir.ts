import { randomBytes } from 'crypto';
import { ShamirShare, RecoveryConfig } from './types';

/**
 * ShamirSecretSharing — M-of-N threshold secret splitting.
 *
 * Splits a secret (patient's master seed) into N shares where any M shares
 * can reconstruct the secret, but M-1 shares reveal nothing.
 *
 * Used for patient key recovery:
 * - Share 1: Patient (paper backup in safety deposit box)
 * - Share 2: Hospital HSM (for emergency break-glass access)
 * - Share 3: Trusted family member
 * - Share 4: Attorney / estate planner
 * - Share 5: Escrow service (e.g., Casa-style multisig)
 *
 * Threshold = 3: Any 3 of 5 shares can recover the seed.
 * If patient loses their device, 3 guardians collaborate to reconstruct.
 *
 * Math: Polynomial interpolation over GF(256).
 * Each byte of the secret is independently split using a random polynomial
 * of degree (threshold-1) over the Galois field GF(2^8).
 *
 * This is a REAL implementation of Shamir's Secret Sharing, not a stub.
 */

// GF(256) arithmetic using the irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11B)
const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);

// Initialize GF(256) lookup tables using generator 3 (primitive element for 0x11B)
(function initGF256() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    // Multiply by generator 3 in GF(256): x * 3 = x * (2 + 1) = (x << 1) ^ x
    // Then reduce modulo the irreducible polynomial if needed
    let x2 = x << 1;
    if (x2 & 0x100) x2 ^= 0x11B; // Reduce x*2
    x = x2 ^ x; // x*3 = x*2 + x (addition in GF(256) is XOR)
  }
  EXP_TABLE[255] = EXP_TABLE[0]; // Wrap around
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 255];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] - LOG_TABLE[b] + 255) % 255];
}

export class ShamirSecretSharing {
  /**
   * Split a secret into N shares with threshold M.
   * Any M shares can reconstruct the secret.
   *
   * @param secret - The secret to split (e.g., 32-byte seed)
   * @param threshold - Minimum shares needed to reconstruct (M)
   * @param totalShares - Total number of shares to generate (N)
   * @param labels - Human-readable labels for each share holder
   */
  static split(
    secret: Uint8Array,
    threshold: number,
    totalShares: number,
    labels?: string[]
  ): ShamirShare[] {
    if (threshold < 2) throw new Error('Threshold must be >= 2');
    if (threshold > totalShares) throw new Error('Threshold cannot exceed total shares');
    if (totalShares > 255) throw new Error('Maximum 255 shares');
    if (totalShares > 5) throw new Error('Medi-Hive limits to 5 shares for key management');

    const defaultLabels = ['patient', 'hospital_hsm', 'family_member', 'attorney', 'escrow_service'];
    const shareLabels = labels ?? defaultLabels.slice(0, totalShares);

    const shares: ShamirShare[] = [];
    const now = new Date().toISOString();

    // Pre-allocate share data arrays
    const shareDataArrays: Uint8Array[] = [];
    for (let i = 0; i < totalShares; i++) {
      shareDataArrays.push(new Uint8Array(secret.length));
    }

    // For each byte, generate ONE random polynomial and evaluate at each share's x
    for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
      // Generate random coefficients for polynomial: f(x) = secret[byteIdx] + a1*x + a2*x^2 + ... + a(t-1)*x^(t-1)
      const coefficients = new Uint8Array(threshold);
      coefficients[0] = secret[byteIdx]; // Constant term = secret byte

      // Random coefficients for higher-order terms
      const randomCoeffs = randomBytes(threshold - 1);
      for (let i = 1; i < threshold; i++) {
        coefficients[i] = randomCoeffs[i - 1];
      }

      // Evaluate the SAME polynomial at each share's x value
      for (let shareIdx = 0; shareIdx < totalShares; shareIdx++) {
        const x = shareIdx + 1; // 1-indexed to avoid x=0 which reveals secret
        shareDataArrays[shareIdx][byteIdx] = this.evaluatePolynomial(coefficients, x);
      }
    }

    for (let shareIdx = 0; shareIdx < totalShares; shareIdx++) {
      shares.push({
        index: shareIdx + 1,
        data: shareDataArrays[shareIdx],
        threshold,
        totalShares,
        createdAt: now,
        holderLabel: shareLabels[shareIdx] ?? `share-${shareIdx + 1}`,
      });
    }

    return shares;
  }

  /**
   * Reconstruct the secret from M shares.
   * Uses Lagrange interpolation over GF(256).
   *
   * @param shares - Array of M shares (must meet threshold)
   * @returns The reconstructed secret
   */
  static reconstruct(shares: ShamirShare[]): Uint8Array {
    if (shares.length === 0) throw new Error('No shares provided');

    const threshold = shares[0].threshold;
    if (shares.length < threshold) {
      throw new Error(`Need ${threshold} shares to reconstruct, only ${shares.length} provided`);
    }

    // Use exactly threshold shares (ignore extras for determinism)
    const usedShares = shares.slice(0, threshold);
    const secretLength = usedShares[0].data.length;

    // Verify all shares have same length
    if (usedShares.some((s) => s.data.length !== secretLength)) {
      throw new Error('Share data length mismatch');
    }

    const secret = new Uint8Array(secretLength);

    // For each byte position, perform Lagrange interpolation to find f(0)
    for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
      secret[byteIdx] = this.lagrangeInterpolateAtZero(
        usedShares.map((s) => s.index),
        usedShares.map((s) => s.data[byteIdx])
      );
    }

    return secret;
  }

  /**
   * Verify that a set of shares can reconstruct the expected secret.
   * Used for periodic recovery verification (recommended annually).
   */
  static verify(
    shares: ShamirShare[],
    expectedHash: Uint8Array
  ): boolean {
    try {
      const reconstructed = this.reconstruct(shares);
      const { createHash } = require('crypto');
      const hash = createHash('sha256').update(Buffer.from(reconstructed)).digest();
      return Buffer.from(hash).equals(Buffer.from(expectedHash));
    } catch {
      return false;
    }
  }

  /**
   * Generate a recovery configuration for a patient.
   * Splits the seed and returns labeled shares ready for distribution.
   */
  static createRecoveryConfig(
    seed: Uint8Array,
    threshold: number = 3,
    labels: string[] = ['patient', 'hospital_hsm', 'family_member', 'attorney', 'escrow_service']
  ): RecoveryConfig {
    const totalShares = labels.length;
    const shares = this.split(seed, threshold, totalShares, labels);

    return {
      threshold,
      totalShares,
      shares,
      lastVerified: new Date().toISOString(),
    };
  }

  /**
   * Simulate a recovery scenario with a subset of shares.
   * Returns whether the given shares are sufficient.
   */
  static canRecover(shares: ShamirShare[]): { canRecover: boolean; sharesNeeded: number; sharesProvided: number } {
    if (shares.length === 0) return { canRecover: false, sharesNeeded: 0, sharesProvided: 0 };
    const threshold = shares[0].threshold;
    return {
      canRecover: shares.length >= threshold,
      sharesNeeded: threshold,
      sharesProvided: shares.length,
    };
  }

  // === Private GF(256) operations ===

  /** Evaluate a polynomial at point x over GF(256) */
  private static evaluatePolynomial(coefficients: Uint8Array, x: number): number {
    let result = 0;
    let xPower = 1; // x^0 = 1

    for (let i = 0; i < coefficients.length; i++) {
      result ^= gfMul(coefficients[i], xPower);
      xPower = gfMul(xPower, x);
    }

    return result;
  }

  /**
   * Lagrange interpolation at x=0 over GF(256).
   * Reconstructs f(0) = secret byte from shares.
   */
  private static lagrangeInterpolateAtZero(
    xValues: number[],
    yValues: number[]
  ): number {
    let result = 0;
    const k = xValues.length;

    for (let i = 0; i < k; i++) {
      let basis = yValues[i]; // Start with y_i

      for (let j = 0; j < k; j++) {
        if (i === j) continue;

        // basis *= (0 - x_j) / (x_i - x_j)
        // In GF(256): subtraction = XOR, so 0 - x_j = x_j
        basis = gfMul(basis, gfDiv(xValues[j], xValues[i] ^ xValues[j]));
      }

      result ^= basis; // Addition in GF(256) = XOR
    }

    return result;
  }
}
