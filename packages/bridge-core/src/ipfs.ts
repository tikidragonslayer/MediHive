import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * IPFSStorage — Upload and retrieve encrypted medical records from IPFS via Pinata.
 *
 * Flow:
 * 1. Encrypt FHIR bundle with patient's AES-256-GCM key
 * 2. Upload encrypted payload to IPFS via Pinata
 * 3. Get CID (content identifier) back
 * 4. Store CID + content hash on Solana (Record NFT)
 * 5. To read: fetch from IPFS gateway → decrypt with patient key
 *
 * Pinata API: https://docs.pinata.cloud/api-reference
 * Free tier: 500 uploads/month, 1GB storage — sufficient for prototype
 */

export interface IPFSUploadResult {
  cid: string;
  size: number;
  contentHash: string;
  timestamp: string;
  gatewayUrl: string;
}

export interface IPFSConfig {
  pinataJwt: string;
  pinataGateway?: string;
}

export class IPFSStorage {
  private jwt: string;
  private gateway: string;
  private apiBase = 'https://api.pinata.cloud';

  constructor(config: IPFSConfig) {
    this.jwt = config.pinataJwt;
    this.gateway = config.pinataGateway ?? 'https://gateway.pinata.cloud/ipfs';
  }

  /**
   * Encrypt a FHIR bundle and upload to IPFS.
   * Returns the CID and content hash for on-chain storage.
   */
  async uploadEncryptedRecord(
    fhirBundleJson: string,
    encryptionKey: Uint8Array,
    metadata?: { patientId?: string; recordType?: string }
  ): Promise<IPFSUploadResult> {
    // 1. Encrypt
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(fhirBundleJson, 'utf8')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // 2. Package (version + algorithm + nonce + tag + ciphertext)
    const payload = JSON.stringify({
      v: 1,
      alg: 'AES-256-GCM',
      nonce: nonce.toString('base64'),
      tag: tag.toString('base64'),
      ct: encrypted.toString('base64'),
    });

    // 3. Content hash of PLAINTEXT (for on-chain integrity verification)
    const contentHash = createHash('sha256').update(fhirBundleJson).digest('hex');

    // 4. Upload to Pinata
    const cid = await this.pinJsonToIPFS(payload, {
      name: `medihive-record-${Date.now()}`,
      keyvalues: {
        contentHash,
        recordType: metadata?.recordType ?? 'unknown',
        encrypted: 'true',
        version: '1',
      },
    });

    return {
      cid,
      size: Buffer.byteLength(payload),
      contentHash,
      timestamp: new Date().toISOString(),
      gatewayUrl: `${this.gateway}/${cid}`,
    };
  }

  /**
   * Retrieve and decrypt a record from IPFS.
   */
  async retrieveAndDecrypt(
    cid: string,
    encryptionKey: Uint8Array
  ): Promise<{ plaintext: string; verified: boolean }> {
    // 1. Fetch from IPFS gateway
    const response = await fetch(`${this.gateway}/${cid}`);
    if (!response.ok) {
      throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as {
      v: number;
      alg: string;
      nonce: string;
      tag: string;
      ct: string;
    };

    if (payload.v !== 1 || payload.alg !== 'AES-256-GCM') {
      throw new Error(`Unsupported encryption format: v${payload.v} ${payload.alg}`);
    }

    // 2. Decrypt
    const nonce = Buffer.from(payload.nonce, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ciphertext = Buffer.from(payload.ct, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, nonce);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');

    return { plaintext, verified: true };
  }

  /**
   * Verify a record's integrity without decrypting (hash check only).
   */
  async verifyIntegrity(cid: string, expectedContentHash: string, encryptionKey: Uint8Array): Promise<boolean> {
    try {
      const { plaintext } = await this.retrieveAndDecrypt(cid, encryptionKey);
      const actualHash = createHash('sha256').update(plaintext).digest('hex');
      return actualHash === expectedContentHash;
    } catch {
      return false;
    }
  }

  /**
   * Upload raw JSON to Pinata (pinJSONToIPFS endpoint).
   */
  private async pinJsonToIPFS(
    content: string,
    metadata: { name: string; keyvalues: Record<string, string> }
  ): Promise<string> {
    const response = await fetch(`${this.apiBase}/pinning/pinJSONToIPFS`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify({
        pinataContent: JSON.parse(content),
        pinataMetadata: {
          name: metadata.name,
          keyvalues: metadata.keyvalues,
        },
        pinataOptions: {
          cidVersion: 1,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Pinata upload failed: ${response.status} — ${error}`);
    }

    const result = await response.json() as { IpfsHash: string };
    return result.IpfsHash;
  }

  /**
   * Unpin a record from IPFS (for GDPR right-to-erasure).
   * After unpinning + encryption key deletion, data is unrecoverable.
   */
  async unpinRecord(cid: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/pinning/unpin/${cid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.jwt}` },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Pinata unpin failed: ${response.status}`);
    }
  }

  /**
   * List all pinned records (for admin/compliance).
   */
  async listPinnedRecords(options?: {
    pageLimit?: number;
    pageOffset?: number;
    recordType?: string;
  }): Promise<Array<{ cid: string; name: string; size: number; datePinned: string; metadata: Record<string, string> }>> {
    const params = new URLSearchParams({
      pageLimit: String(options?.pageLimit ?? 50),
      pageOffset: String(options?.pageOffset ?? 0),
      status: 'pinned',
    });

    if (options?.recordType) {
      params.set('metadata[keyvalues]', JSON.stringify({
        recordType: { value: options.recordType, op: 'eq' },
      }));
    }

    const response = await fetch(`${this.apiBase}/data/pinList?${params}`, {
      headers: { Authorization: `Bearer ${this.jwt}` },
    });

    if (!response.ok) throw new Error(`Pinata list failed: ${response.status}`);

    const result = await response.json() as {
      rows: Array<{
        ipfs_pin_hash: string;
        metadata: { name: string; keyvalues: Record<string, string> };
        size: number;
        date_pinned: string;
      }>;
    };

    return result.rows.map((r) => ({
      cid: r.ipfs_pin_hash,
      name: r.metadata.name,
      size: r.size,
      datePinned: r.date_pinned,
      metadata: r.metadata.keyvalues,
    }));
  }
}
