"use client";
import { MockNurse, MockPatient } from "../data/mock-hospital";

export function NurseAssignments({ nurses, patients }: { nurses: MockNurse[]; patients: MockPatient[] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Nurse Routing & Assignments</h2>
      <p className="text-gray-400 text-sm">Optimized by MediBrain — re-calculates every 60 seconds</p>

      <div className="space-y-4">
        {nurses.map((nurse) => {
          const nursePatients = patients.filter((p) => nurse.assignedPatients.includes(p.id));
          const allTasks = nursePatients.flatMap((p) => p.pendingTasks.map((t) => ({ ...t, patientName: p.name, room: p.room })));
          const sortedTasks = allTasks.sort((a, b) => {
            const pri = { critical: 0, urgent: 1, routine: 2, low: 3 };
            return pri[a.priority] - pri[b.priority] || new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime();
          });

          return (
            <div key={nurse.id} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{nurse.name}</h3>
                  <p className="text-xs text-gray-500">
                    Floor {nurse.currentFloor} | Certs: {nurse.certifications.join(", ")} |
                    Shift: {new Date(nurse.shiftStart).toLocaleTimeString()} - {new Date(nurse.shiftEnd).toLocaleTimeString()}
                  </p>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${nurse.workloadScore > 8 ? "text-red-400" : nurse.workloadScore > 6 ? "text-amber-400" : "text-green-400"}`}>
                    {nurse.workloadScore}/10
                  </div>
                  <p className="text-xs text-gray-500">workload</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                {nursePatients.map((p) => (
                  <span key={p.id} className="px-2 py-1 bg-gray-800 rounded text-xs">
                    Rm {p.room}: {p.name} (acuity {p.acuityScore})
                  </span>
                ))}
              </div>

              <div className="space-y-1">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Optimized Task Queue</p>
                {sortedTasks.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 bg-gray-800/30 rounded text-sm">
                    <span className="text-gray-600 w-5 text-right">{i + 1}.</span>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      t.priority === "critical" ? "bg-red-500" : t.priority === "urgent" ? "bg-amber-500" : t.priority === "routine" ? "bg-blue-500" : "bg-gray-500"
                    }`} />
                    <span className="text-gray-400 w-16 flex-shrink-0">Rm {t.room}</span>
                    <span className="text-gray-300 flex-1">{t.description}</span>
                    <span className="text-xs text-gray-500">{new Date(t.scheduledTime).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
