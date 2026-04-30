"use client";

import { useEffect, useState } from "react";

/**
 * Patient view that talks to the api-server's VaultDriver-backed v2
 * endpoints: /api/patient/v2/passport, /v2/records/:id, /v2/audit/:id.
 *
 * Uses dev-mode auth headers — set X-MediHive-Dev: true and the api-server
 * skips signature verification (only when NODE_ENV !== 'production').
 *
 * Configure the api base URL via NEXT_PUBLIC_API_BASE_URL. Defaults to
 * http://localhost:4000 to match the api-server's default port.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

interface Passport {
  id: string;
  authority: string;
  status: string;
  recoveryThreshold: number;
  guardians: string[];
  emergencyHospitalShard: boolean;
  createdAt: number;
}

interface MedicalRecord {
  id: string;
  patientPassport: string;
  recordType: string;
  contentHash: string;
  storageLocator: string;
  abePolicy: string;
  author: string;
  createdAt: number;
  status: string;
}

interface AuditEntry {
  seq: number;
  actor: string;
  action: string;
  targetPatient: string;
  timestamp: number;
  metadata: string;
  entryHash: string;
}

interface VaultInfo {
  kind: string;
  backend: string;
  version: string;
}

function authHeaders(pubkey: string): HeadersInit {
  return {
    "X-MediHive-Dev": "true",
    "X-MediHive-Role": "patient",
    "X-MediHive-Pubkey": pubkey,
    "Content-Type": "application/json",
  };
}

export default function PatientPage() {
  const [pubkey, setPubkey] = useState<string>("");
  const [passportId, setPassportId] = useState<string>("");
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Probe the api-server's profile on mount.
  useEffect(() => {
    fetch(`${API_BASE}/health/vault`)
      .then((r) => r.json())
      .then((info: VaultInfo) => setVaultInfo(info))
      .catch(() => setVaultInfo(null));
  }, []);

  async function loadPassport() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/patient/v2/passport`, {
        headers: authHeaders(pubkey || "dev-pubkey"),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string; hint?: string };
        setError(`${res.status}: ${body.error ?? "Unknown"}${body.hint ? " — " + body.hint : ""}`);
        return;
      }
      const body = (await res.json()) as { passport: Passport };
      setPassport(body.passport);
      setPassportId(body.passport.id);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecords() {
    if (!passportId) {
      setError("Need passport ID first.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/patient/v2/records/${passportId}?limit=50`, {
        headers: authHeaders(pubkey || "dev-pubkey"),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(`${res.status}: ${body.error ?? "Records fetch failed"}`);
        return;
      }
      const body = (await res.json()) as { records: MedicalRecord[] };
      setRecords(body.records);
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit() {
    if (!passportId) {
      setError("Need passport ID first.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/patient/v2/audit/${passportId}?limit=50`, {
        headers: authHeaders(pubkey || "dev-pubkey"),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(`${res.status}: ${body.error ?? "Audit fetch failed"}`);
        return;
      }
      const body = (await res.json()) as { entries: AuditEntry[] };
      setAudit(body.entries);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ marginBottom: 32, paddingBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Patient view (vault-driven)</h1>
        <p style={{ color: "#6b7280", marginTop: 6 }}>
          Calls <code>/api/patient/v2/*</code> through the api-server&apos;s active VaultDriver.
        </p>
        {vaultInfo ? (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "#f3f4f6", borderRadius: 6, fontSize: 13 }}>
            <strong>API profile:</strong> {vaultInfo.kind} · <strong>backend:</strong> {vaultInfo.backend} ·{" "}
            <strong>driver:</strong> {vaultInfo.version}
          </div>
        ) : (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "#fef3c7", borderRadius: 6, fontSize: 13 }}>
            Could not reach api-server at <code>{API_BASE}</code>. Set <code>NEXT_PUBLIC_API_BASE_URL</code> or boot the api-server.
          </div>
        )}
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Identity</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input
            type="text"
            placeholder="Wallet pubkey (or leave blank for dev-pubkey)"
            value={pubkey}
            onChange={(e) => setPubkey(e.target.value)}
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
          />
          <button onClick={loadPassport} disabled={loading} style={btnStyle}>
            Load passport
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input
            type="text"
            placeholder="Passport ID (UUID)"
            value={passportId}
            onChange={(e) => setPassportId(e.target.value)}
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
          />
          <button onClick={loadRecords} disabled={loading || !passportId} style={btnStyle}>
            Records
          </button>
          <button onClick={loadAudit} disabled={loading || !passportId} style={btnStyle}>
            Audit
          </button>
        </div>
      </section>

      {error && (
        <div style={{ padding: 12, background: "#fee2e2", color: "#991b1b", borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {passport && (
        <Card title="Passport">
          <Grid>
            <Field k="ID" v={<code>{passport.id}</code>} />
            <Field k="Authority" v={<code>{passport.authority}</code>} />
            <Field k="Status" v={<Badge color={statusColor(passport.status)}>{passport.status}</Badge>} />
            <Field k="Recovery threshold" v={`${passport.recoveryThreshold} of ${passport.guardians.length}`} />
            <Field k="Created" v={new Date(passport.createdAt * 1000).toISOString()} />
            <Field k="Emergency hospital shard" v={passport.emergencyHospitalShard ? "yes" : "no"} />
          </Grid>
        </Card>
      )}

      {records.length > 0 && (
        <Card title={`Records (${records.length})`}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Author</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Storage</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>
                    <Badge color="#6366f1">{r.recordType}</Badge>
                  </td>
                  <td style={tdStyle}>
                    <code style={codeStyle}>{r.author}</code>
                  </td>
                  <td style={tdStyle}>
                    <Badge color={statusColor(r.status)}>{r.status}</Badge>
                  </td>
                  <td style={tdStyle}>{new Date(r.createdAt * 1000).toISOString().split(".")[0]}</td>
                  <td style={tdStyle}>
                    <code style={codeStyle}>{r.storageLocator}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {audit.length > 0 && (
        <Card title={`Audit trail (${audit.length})`}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Seq</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Actor</th>
                <th style={thStyle}>Timestamp</th>
                <th style={thStyle}>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.seq}>
                  <td style={tdStyle}>{a.seq}</td>
                  <td style={tdStyle}>
                    <Badge color="#0891b2">{a.action}</Badge>
                  </td>
                  <td style={tdStyle}>
                    <code style={codeStyle}>{a.actor}</code>
                  </td>
                  <td style={tdStyle}>{new Date(a.timestamp * 1000).toISOString().split(".")[0]}</td>
                  <td style={tdStyle}>{a.metadata}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>
            Each entry is hash-chained: <code>SHA-256(prevHash ‖ canonical(payload))</code>. Tampering anywhere in
            the chain produces a different root hash, detectable against an externally-published WORM checkpoint.
          </p>
        </Card>
      )}

      <footer style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid #e5e7eb", color: "#6b7280", fontSize: 13 }}>
        AGPL-3.0 ·{" "}
        <a href="https://github.com/tikidragonslayer/MediHive" style={{ color: "#3b82f6" }}>
          source on GitHub
        </a>
      </footer>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#3b82f6",
  color: "white",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
  fontWeight: 600,
  color: "#374151",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #f3f4f6",
};

const codeStyle: React.CSSProperties = {
  fontSize: 12,
  background: "#f3f4f6",
  padding: "2px 6px",
  borderRadius: 4,
};

function statusColor(s: string): string {
  if (s === "active" || s === "final") return "#10b981";
  if (s === "draft") return "#6b7280";
  if (s === "suspended" || s === "amended") return "#f59e0b";
  if (s === "revoked" || s === "voided") return "#ef4444";
  return "#6b7280";
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        background: color + "20",
        color,
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        border: `1px solid ${color}40`,
      }}
    >
      {children}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        marginBottom: 24,
        padding: 20,
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px" }}>{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 24px" }}>{children}</div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
      <div style={{ marginTop: 2, fontSize: 14 }}>{v}</div>
    </div>
  );
}
