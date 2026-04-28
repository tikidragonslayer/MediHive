"use client";
import { MockPatient } from "../data/mock-hospital";

export function AlertCenter({ patients }: { patients: MockPatient[] }) {
  const allAlerts = patients.flatMap((p) =>
    p.alerts.map((a) => ({ ...a, patientName: p.name, room: p.room, patientId: p.id, acuityScore: p.acuityScore }))
  );

  const active = allAlerts.filter((a) => !a.acknowledged);
  const acknowledged = allAlerts.filter((a) => a.acknowledged);
  const totalToday = allAlerts.length;
  const suppressed = Math.round(totalToday * 0.78); // 78% suppression rate demo

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Alert Triage Center</h2>
      <p className="text-gray-400 text-sm">MediBrain contextualizes alerts to reduce alarm fatigue</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-bold text-red-400">{active.length}</p>
          <p className="text-xs text-gray-500 mt-1">Active Alerts</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-bold text-green-400">{suppressed}</p>
          <p className="text-xs text-gray-500 mt-1">Suppressed (False)</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-bold text-cyan-400">78%</p>
          <p className="text-xs text-gray-500 mt-1">Reduction Rate</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-bold text-gray-400">{acknowledged.length}</p>
          <p className="text-xs text-gray-500 mt-1">Acknowledged</p>
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h3 className="font-semibold mb-3 text-red-400">Active Alerts (Significant)</h3>
        <div className="space-y-2">
          {active.length === 0 && <p className="text-gray-500 text-sm">No active alerts</p>}
          {active.sort((a, b) => {
            const sev = { critical: 0, high: 1, medium: 2, low: 3 };
            return sev[a.severity] - sev[b.severity];
          }).map((a, i) => (
            <div key={i} className={`flex items-center justify-between p-3 rounded-lg border ${
              a.severity === "critical" ? "bg-red-500/10 border-red-500/30" : a.severity === "high" ? "bg-amber-500/10 border-amber-500/30" : "bg-gray-800/50 border-gray-700"
            }`}>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                  a.severity === "critical" ? "bg-red-500 text-white" : a.severity === "high" ? "bg-amber-500 text-black" : "bg-gray-600 text-white"
                }`}>{a.severity}</span>
                <div>
                  <p className="text-sm font-medium">{a.message}</p>
                  <p className="text-xs text-gray-400">Rm {a.room} — {a.patientName} (acuity {a.acuityScore})</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">{new Date(a.time).toLocaleTimeString()}</p>
                <button className="text-xs text-cyan-400 hover:underline mt-1">Acknowledge</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
