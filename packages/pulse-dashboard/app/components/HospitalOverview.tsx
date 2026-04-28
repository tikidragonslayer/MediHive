"use client";
import { MockData } from "../data/mock-hospital";

export function HospitalOverview({ data, onSelectPatient }: { data: MockData; onSelectPatient: (id: string) => void }) {
  const m = data.hospitalMetrics;
  const reductionRate = Math.round((m.alertsSuppressed / m.alertsToday) * 100);
  const criticalPatients = data.patients.filter((p) => p.acuityScore >= 7).sort((a, b) => b.acuityScore - a.acuityScore);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h2 className="text-2xl font-bold">Hospital Command Center</h2>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-xs text-cyan-400 font-medium">
          Simulated Environment — 5 Demo Patients
        </span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Bed Occupancy" value={`${m.occupiedBeds}/${m.totalBeds}`} sub={`${Math.round((m.occupiedBeds / m.totalBeds) * 100)}%`} color="cyan" />
        <MetricCard label="Avg Acuity" value={m.avgAcuity.toFixed(1)} sub="/10" color="amber" />
        <MetricCard label="Alert Reduction" value={`${reductionRate}%`} sub={`${m.alertsSuppressed} suppressed`} color="green" />
        <MetricCard label="Records Minted" value={m.recordsMintedToday.toString()} sub={`${m.solanaTransactions} txns today`} color="purple" />
      </div>

      {/* Critical Patients */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3 text-red-400">Critical Patients (Acuity 7+)</h3>
        <div className="space-y-2">
          {criticalPatients.map((p) => (
            <button key={p.id} onClick={() => onSelectPatient(p.id)}
              className="w-full flex items-center justify-between p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors text-left">
              <div className="flex items-center gap-3">
                <AcuityBadge score={p.acuityScore} />
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-gray-400">Rm {p.room} — {p.primaryDiagnosis}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">{p.alerts.filter((a) => !a.acknowledged).length} active alerts</p>
                <p className="text-xs text-gray-500">{p.pendingTasks.length} pending tasks</p>
              </div>
            </button>
          ))}
          {criticalPatients.length === 0 && <p className="text-gray-500 text-sm">No critical patients</p>}
        </div>
      </div>

      {/* Nurse Workload */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3">Nurse Workload Distribution</h3>
        <div className="space-y-3">
          {data.nurses.map((n) => (
            <div key={n.id} className="space-y-1 sm:space-y-0 sm:flex sm:items-center sm:gap-4">
              <div className="text-sm font-medium sm:w-40 sm:truncate">{n.name}</div>
              <div className="flex items-center gap-3 flex-1">
                <div className="flex-1 bg-gray-800 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      n.workloadScore > 8 ? "bg-red-500" : n.workloadScore > 6 ? "bg-amber-500" : "bg-green-500"
                    }`}
                    style={{ width: `${n.workloadScore * 10}%` }}
                  />
                </div>
                <span className="text-sm w-12 text-right">{n.workloadScore}/10</span>
                <span className="text-xs text-gray-500 w-20">{n.assignedPatients.length} patients</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Blockchain Activity */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3">Blockchain Activity (Solana Devnet)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <p className="text-2xl font-bold text-cyan-400">{data.patients.reduce((s, p) => s + p.nftStatus.recordCount, 0)}</p>
            <p className="text-xs text-gray-500 mt-1">Record NFTs</p>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <p className="text-2xl font-bold text-green-400">{data.patients.reduce((s, p) => s + p.nftStatus.activeGrants, 0)}</p>
            <p className="text-xs text-gray-500 mt-1">Active Access Grants</p>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <p className="text-2xl font-bold text-purple-400">{data.patients.filter((p) => p.nftStatus.passportMinted).length}/{data.patients.length}</p>
            <p className="text-xs text-gray-500 mt-1">Patient Passports</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colorMap: Record<string, string> = { cyan: "text-cyan-400", amber: "text-amber-400", green: "text-green-400", purple: "text-purple-400" };
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${colorMap[color]}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function AcuityBadge({ score }: { score: number }) {
  const bg = score >= 8 ? "bg-red-500/20 text-red-400 border-red-500/30"
    : score >= 6 ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
    : "bg-green-500/20 text-green-400 border-green-500/30";
  return <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border text-sm font-bold ${bg}`}>{score.toFixed(1)}</span>;
}
