"use client";

const LAYERS = [
  { name: "Layer 1: Patient Identity", desc: "Solana wallet-based patient passport with NFT-minted medical records", icon: "1" },
  { name: "Layer 2: Data Encryption", desc: "Shamir Secret Sharing (3-of-5 threshold) for patient-controlled key management", icon: "2" },
  { name: "Layer 3: FHIR R4 Interface", desc: "HL7 FHIR R4 compliant data model for interoperability with EHR systems", icon: "3" },
  { name: "Layer 4: Smart Contracts", desc: "On-chain access grants, consent management, and audit trail via Solana programs", icon: "4" },
  { name: "Layer 5: Clinical Dashboard", desc: "Real-time nurse routing, alert triage, BCMA medication scanning, AI scribe", icon: "5" },
  { name: "Layer 6: Storage", desc: "IPFS + Arweave for decentralized, permanent medical record storage", icon: "6" },
];

const DIFFERENTIATORS = [
  { title: "Patient-Owned Records", desc: "Patients hold their own medical data via blockchain-anchored NFTs. No vendor lock-in." },
  { title: "Shamir Encryption", desc: "3-of-5 threshold key splitting ensures no single party can access records without patient consent." },
  { title: "FHIR R4 Interoperability", desc: "Native HL7 FHIR R4 data model enables plug-and-play integration with existing hospital EHR systems." },
  { title: "Solana-Anchored Audit Trail", desc: "Every access, modification, and consent change is permanently recorded on Solana." },
  { title: "AI-Powered Clinical Tools", desc: "SOAP note scribe, alert fatigue reduction (78% noise suppressed), and intelligent nurse routing." },
  { title: "HIPAA-Design Compliance", desc: "Architecture designed from the ground up for HIPAA compliance with built-in BAA support." },
];

export function AboutMediHive() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-2">
          About Medi-Hive
        </h2>
        <p className="text-gray-400 max-w-2xl mx-auto">
          A blockchain-anchored, patient-owned medical record platform with an intelligent
          hospital management dashboard. Built for the next generation of healthcare data sovereignty.
        </p>
      </div>

      {/* Architecture Diagram (text-based) */}
      <div>
        <h3 className="text-lg font-semibold text-cyan-400 mb-4 uppercase tracking-wider">
          Six-Layer Architecture
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {LAYERS.map((layer) => (
            <div
              key={layer.name}
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-cyan-500/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-sm flex-shrink-0">
                  {layer.icon}
                </div>
                <div>
                  <h4 className="font-semibold text-white text-sm">{layer.name}</h4>
                  <p className="text-gray-400 text-xs mt-1">{layer.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key Differentiators */}
      <div>
        <h3 className="text-lg font-semibold text-cyan-400 mb-4 uppercase tracking-wider">
          Key Differentiators
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DIFFERENTIATORS.map((d) => (
            <div
              key={d.title}
              className="bg-gray-900 border border-gray-800 rounded-lg p-4"
            >
              <h4 className="font-semibold text-white text-sm mb-1">{d.title}</h4>
              <p className="text-gray-400 text-xs">{d.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Current Stage */}
      <div className="bg-gray-900 border border-cyan-500/20 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-cyan-400 mb-3 uppercase tracking-wider">
          Current Stage
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-gray-300 text-sm">Working clinical dashboard with real-time patient management</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-gray-300 text-sm">Compiled Solana programs (patient passport, record NFT, consent manager)</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-gray-300 text-sm">FHIR R4 data model with full CRUD API + role-based access control</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-gray-300 text-sm">AI-powered SOAP note generation from clinical transcripts</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-gray-300 text-sm">Barcode medication administration (BCMA) verification system</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="text-gray-300 text-sm">HIPAA-design compliance -- architecture review complete, BAA templates prepared</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="text-gray-300 text-sm">Shamir encryption integration -- key splitting implemented, production hardening pending</span>
          </div>
        </div>
      </div>

      {/* Project */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-cyan-400 mb-3 uppercase tracking-wider">
          Open Source
        </h3>
        <p className="text-gray-300 text-sm mb-2">
          MediHive is open-source software released under the{" "}
          <span className="text-white font-semibold">GNU Affero General Public License v3.0</span>.
          Modified deployments must publish their source under the same license.
        </p>
        <p className="text-gray-400 text-sm">
          Contributions, hospital pilots, and security review are welcome. See{" "}
          <code className="text-cyan-400">CONTRIBUTING.md</code> in the repository for how to participate.
        </p>
      </div>

      {/* Footer */}
      <div className="text-center text-gray-500 text-xs border-t border-gray-800 pt-6">
        <p>
          Built with Next.js, Solana, FHIR R4, and TypeScript &middot; AGPL-3.0
        </p>
      </div>
    </div>
  );
}
