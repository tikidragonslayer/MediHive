"use client";

export function BlockchainStatus() {
  const programs = [
    { name: "Patient Passport (SBT)", id: "4qcK...8jKn", status: "deployed", accounts: 5 },
    { name: "Record Manager", id: "21s2...Uk4i", status: "deployed", accounts: 56 },
    { name: "Access Grants", id: "CBsD...HHW2", status: "deployed", accounts: 13 },
    { name: "Consent Registry", id: "FJTD...3rcx", status: "deployed", accounts: 8 },
    { name: "Audit Logger", id: "FQMN...k8is", status: "deployed", accounts: 156 },
  ];

  const recentTxns = [
    { type: "Record Minted", patient: "P001", time: "14:28:03", sig: "5Kx9...mN2p", cost: "$0.00025" },
    { type: "Access Granted", patient: "P003", time: "14:27:45", sig: "3Rw7...pQ4x", cost: "$0.00025" },
    { type: "Consent Recorded", patient: "P002", time: "14:25:12", sig: "8Yv2...kL9n", cost: "$0.00025" },
    { type: "Audit Logged", patient: "P001", time: "14:24:58", sig: "2Mn4...wR5t", cost: "$0.000005" },
    { type: "Grant Revoked", patient: "P004", time: "14:22:30", sig: "7Jp8...cF3v", cost: "$0.00025" },
    { type: "Record Amended", patient: "P003", time: "14:20:15", sig: "4Ks1...mH7b", cost: "$0.00025" },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Blockchain Status</h2>
      <p className="text-gray-400 text-sm">MediVault on Solana Devnet — 5 programs deployed</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-bold text-cyan-400">156</p>
          <p className="text-xs text-gray-500 mt-1">Transactions Today</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-bold text-green-400">$0.039</p>
          <p className="text-xs text-gray-500 mt-1">Total Cost Today</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-bold text-purple-400">~400ms</p>
          <p className="text-xs text-gray-500 mt-1">Avg Confirmation</p>
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h3 className="font-semibold mb-3">Deployed Programs</h3>
        <div className="space-y-2">
          {programs.map((prog) => (
            <div key={prog.name} className="flex items-center justify-between p-2 bg-gray-800/50 rounded text-sm">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="font-medium">{prog.name}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500 font-mono">{prog.id}</span>
                <span className="text-xs text-cyan-400">{prog.accounts} accounts</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h3 className="font-semibold mb-3">Recent Transactions</h3>
        <div className="space-y-1">
          {recentTxns.map((tx, i) => (
            <div key={i} className="flex items-center justify-between p-2 bg-gray-800/30 rounded text-sm">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${
                  tx.type.includes("Record") ? "bg-cyan-400" : tx.type.includes("Grant") || tx.type.includes("Revoke") ? "bg-purple-400" : tx.type.includes("Consent") ? "bg-green-400" : "bg-gray-400"
                }`} />
                <span className="text-gray-300">{tx.type}</span>
                <span className="text-xs text-gray-500">{tx.patient}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-gray-600">{tx.sig}</span>
                <span className="text-xs text-gray-500">{tx.cost}</span>
                <span className="text-xs text-gray-600">{tx.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-cyan-500/20 p-4">
        <h3 className="font-semibold mb-2 text-cyan-400">Encryption Status</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between"><span className="text-gray-400">Algorithm</span><span>AES-256-GCM</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Key Derivation</span><span>BIP-44 HD Wallet</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Access Control</span><span>PRE + ABE (planned)</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Recovery</span><span>Shamir 3-of-5</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Off-chain Storage</span><span>IPFS + Arweave</span></div>
          <div className="flex justify-between"><span className="text-gray-400">HIPAA Compliant</span><span className="text-green-400">Yes</span></div>
        </div>
      </div>
    </div>
  );
}
