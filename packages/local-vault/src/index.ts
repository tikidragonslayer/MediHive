/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

export { LocalVaultDriver } from './driver';
export { computeEntryHash, replayChain, verifyChain, canonicalize, ZERO_HASH } from './audit-chain';
export {
  PatientBridgeStore,
  DEFAULT_SIGNATURE_SKEW_SECONDS,
} from './bridge-store';
export type {
  PatientBridge,
  CreateBridgeInput,
  BridgeEstablishedVia,
  BridgeSignatureVerifier,
} from './bridge-store';
export { canonicalizeBridge } from './bridge-canonical';
export type { BridgePayload } from './bridge-canonical';
export { Ed25519BridgeVerifier } from './ed25519-verifier';
export { FederatedVaultDriver } from './federated-driver';
export type { FederatedVaultDriverOptions } from './federated-driver';
