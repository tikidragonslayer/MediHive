"use client";
import { MockPatient } from "../data/mock-hospital";

export function PatientList({ patients, onSelectPatient }: { patients: MockPatient[]; onSelectPatient: (id: string) => void }) {
  const sorted = [...patients].sort((a, b) => b.acuityScore - a.acuityScore);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">All Patients</h2>

      {/* Mobile card view */}
      <div className="space-y-3 md:hidden">
        {sorted.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectPatient(p.id)}
            className="w-full text-left bg-gray-900 rounded-xl border border-gray-800 p-4 hover:bg-gray-800/80 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold flex-shrink-0 ${
                  p.acuityScore >= 8 ? "bg-red-500/20 text-red-400" : p.acuityScore >= 6 ? "bg-amber-500/20 text-amber-400" : "bg-green-500/20 text-green-400"
                }`}>{p.acuityScore.toFixed(1)}</span>
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.age}yo {p.gender} — Rm {p.room}</p>
                </div>
              </div>
              {p.alerts.filter((a) => !a.acknowledged).length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/10 text-red-400 rounded text-xs flex-shrink-0">
                  {p.alerts.filter((a) => !a.acknowledged).length} alerts
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400 mt-2 truncate">{p.primaryDiagnosis}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span>HR {p.vitals.heartRate}</span>
              <span>BP {p.vitals.systolicBP}/{p.vitals.diastolicBP}</span>
              <span>SpO2 {p.vitals.spO2}%</span>
              <span className="text-cyan-400 ml-auto">{p.nftStatus.recordCount} records</span>
            </div>
          </button>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="px-4 py-3 text-left">Acuity</th>
                <th className="px-4 py-3 text-left">Patient</th>
                <th className="px-4 py-3 text-left">Room</th>
                <th className="px-4 py-3 text-left">Diagnosis</th>
                <th className="px-4 py-3 text-left">Vitals</th>
                <th className="px-4 py-3 text-left">Alerts</th>
                <th className="px-4 py-3 text-left">NFT Records</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} onClick={() => onSelectPatient(p.id)} className="border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded text-xs font-bold ${
                      p.acuityScore >= 8 ? "bg-red-500/20 text-red-400" : p.acuityScore >= 6 ? "bg-amber-500/20 text-amber-400" : "bg-green-500/20 text-green-400"
                    }`}>{p.acuityScore.toFixed(1)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.age}yo {p.gender}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{p.room}</td>
                  <td className="px-4 py-3 text-gray-400 max-w-[200px] truncate">{p.primaryDiagnosis}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs space-y-0.5">
                      <p>HR {p.vitals.heartRate} | BP {p.vitals.systolicBP}/{p.vitals.diastolicBP}</p>
                      <p className="text-gray-500">SpO2 {p.vitals.spO2}% | T {p.vitals.temperature}°C</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {p.alerts.filter((a) => !a.acknowledged).length > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/10 text-red-400 rounded text-xs">
                        {p.alerts.filter((a) => !a.acknowledged).length} active
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-cyan-400">{p.nftStatus.recordCount} records</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
