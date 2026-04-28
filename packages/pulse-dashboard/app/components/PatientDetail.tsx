"use client";
import { useState } from "react";
import { MockPatient } from "../data/mock-hospital";

// ── NEWS2 scoring logic (mirrors brain-engine/src/acuity.ts) ──

interface NEWS2VitalScore {
  label: string;
  value: string;
  score: number;
  status: "Normal" | "Low" | "High";
}

function calculateNEWS2Breakdown(vitals: MockPatient["vitals"]): {
  vitalScores: NEWS2VitalScore[];
  news2Base: number;
  diagnosisComplexity: number;
  taskBurden: number;
  total: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
} {
  const vitalScores: NEWS2VitalScore[] = [];

  // Respiratory Rate
  let rrScore = 0;
  const rr = vitals.respiratoryRate;
  if (rr <= 8) { rrScore = 3; }
  else if (rr <= 11) { rrScore = 1; }
  else if (rr <= 20) { rrScore = 0; }
  else if (rr <= 24) { rrScore = 2; }
  else { rrScore = 3; }
  vitalScores.push({
    label: "Respiration Rate",
    value: `${rr}/min`,
    score: rrScore,
    status: rrScore === 0 ? "Normal" : rr > 20 ? "High" : "Low",
  });

  // SpO2
  let spo2Score = 0;
  const spo2 = vitals.spO2;
  if (spo2 <= 91) { spo2Score = 3; }
  else if (spo2 <= 93) { spo2Score = 2; }
  else if (spo2 <= 95) { spo2Score = 1; }
  else { spo2Score = 0; }
  vitalScores.push({
    label: "SpO2",
    value: `${spo2}%`,
    score: spo2Score,
    status: spo2Score === 0 ? "Normal" : "Low",
  });

  // Temperature
  let tempScore = 0;
  const temp = vitals.temperature;
  if (temp <= 35.0) { tempScore = 3; }
  else if (temp <= 36.0) { tempScore = 1; }
  else if (temp <= 38.0) { tempScore = 0; }
  else if (temp <= 39.0) { tempScore = 1; }
  else { tempScore = 2; }
  vitalScores.push({
    label: "Temperature",
    value: `${temp}°C`,
    score: tempScore,
    status: tempScore === 0 ? "Normal" : temp > 38.0 ? "High" : "Low",
  });

  // Systolic BP
  let sbpScore = 0;
  const sbp = vitals.systolicBP;
  if (sbp <= 90) { sbpScore = 3; }
  else if (sbp <= 100) { sbpScore = 2; }
  else if (sbp <= 110) { sbpScore = 1; }
  else if (sbp <= 219) { sbpScore = 0; }
  else { sbpScore = 3; }
  vitalScores.push({
    label: "Systolic BP",
    value: `${sbp} mmHg`,
    score: sbpScore,
    status: sbpScore === 0 ? "Normal" : sbp > 219 ? "High" : "Low",
  });

  // Heart Rate
  let hrScore = 0;
  const hr = vitals.heartRate;
  if (hr <= 40) { hrScore = 3; }
  else if (hr <= 50) { hrScore = 1; }
  else if (hr <= 90) { hrScore = 0; }
  else if (hr <= 110) { hrScore = 1; }
  else if (hr <= 130) { hrScore = 2; }
  else { hrScore = 3; }
  vitalScores.push({
    label: "Heart Rate",
    value: `${hr} bpm`,
    score: hrScore,
    status: hrScore === 0 ? "Normal" : hr > 90 ? "High" : "Low",
  });

  // Consciousness (always Alert for mock data)
  vitalScores.push({
    label: "Consciousness",
    value: "Alert",
    score: 0,
    status: "Normal",
  });

  const news2Base = vitalScores.reduce((sum, v) => sum + v.score, 0);

  return {
    vitalScores,
    news2Base,
    diagnosisComplexity: 0, // Calculated per patient below
    taskBurden: 0,
    total: news2Base,
    level: news2Base >= 7 ? "CRITICAL" : news2Base >= 5 ? "HIGH" : news2Base >= 3 ? "MEDIUM" : "LOW",
  };
}

function getQSOFA(vitals: MockPatient["vitals"]): { score: number; criteria: { label: string; met: boolean }[] } {
  const criteria = [
    { label: "Respiratory rate >= 22", met: vitals.respiratoryRate >= 22 },
    { label: "Systolic BP <= 100", met: vitals.systolicBP <= 100 },
    { label: "Altered consciousness", met: false }, // Mock data always Alert
  ];
  return { score: criteria.filter((c) => c.met).length, criteria };
}

function getDiagnosisComplexity(icdCodes: string[]): number {
  if (icdCodes.length === 0) return 0;
  if (icdCodes.length <= 2) return 0.5;
  if (icdCodes.length <= 5) return 1;
  if (icdCodes.length <= 8) return 1.5;
  return 2;
}

function getTaskBurden(taskCount: number): number {
  if (taskCount <= 2) return 0;
  if (taskCount <= 4) return 0.5;
  if (taskCount <= 6) return 1;
  if (taskCount <= 8) return 1.5;
  return 2;
}

// ── Component ──

export function PatientDetail({ patient: p, onBack }: { patient: MockPatient; onBack: () => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [soapNote, setSoapNote] = useState<string | null>(null);
  const [showNEWS2, setShowNEWS2] = useState(false);

  const news2 = calculateNEWS2Breakdown(p.vitals);
  const diagComp = getDiagnosisComplexity(p.icdCodes);
  const taskBur = getTaskBurden(p.pendingTasks.length);
  const qsofa = getQSOFA(p.vitals);

  // Recalculate total including modifiers
  const totalAcuity = news2.news2Base + diagComp + taskBur;
  const levelLabel = totalAcuity >= 9 ? "CRITICAL" : totalAcuity >= 7 ? "HIGH" : totalAcuity >= 5 ? "MEDIUM" : "LOW";
  const levelColor = totalAcuity >= 9 ? "text-red-400" : totalAcuity >= 7 ? "text-amber-400" : totalAcuity >= 5 ? "text-yellow-400" : "text-green-400";

  const simulateTranscription = () => {
    setIsRecording(true);
    setTimeout(() => {
      setIsRecording(false);
      setSoapNote(`SUBJECTIVE: ${p.age}yo ${p.gender.toLowerCase()} presents with ${p.primaryDiagnosis.toLowerCase()}. Patient reports pain level ${p.vitals.painLevel}/10. ${p.allergies.length > 0 ? `Allergies: ${p.allergies.join(", ")}.` : "No known allergies."}

OBJECTIVE: VS — HR ${p.vitals.heartRate}, BP ${p.vitals.systolicBP}/${p.vitals.diastolicBP}, T ${p.vitals.temperature}°C, RR ${p.vitals.respiratoryRate}, SpO2 ${p.vitals.spO2}%.
Current medications: ${p.medications.map((m) => `${m.name} ${m.dosage} ${m.frequency}`).join(", ")}.

ASSESSMENT: ${p.primaryDiagnosis}. Acuity score ${p.acuityScore}/10.
ICD-10: ${p.icdCodes.join(", ")}

PLAN:
1. Continue current medication regimen
2. Monitor vitals per protocol
3. ${p.pendingTasks[0]?.description ?? "Reassess in 4 hours"}
4. Follow up with attending

[DRAFT — Requires clinician review and sign-off]
[Generated by MediScribe AI — ${new Date().toISOString()}]`);
    }, 3000);
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-400 hover:text-white flex items-center gap-1">
        ← Back to list
      </button>

      {/* Patient Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold">{p.name}</h2>
          <p className="text-gray-400 text-sm sm:text-base">{p.age}yo {p.gender} — Room {p.room} — Admitted {new Date(p.admissionDate).toLocaleDateString()}</p>
          <p className="text-base sm:text-lg mt-1">{p.primaryDiagnosis}</p>
        </div>
        <button
          onClick={() => setShowNEWS2(!showNEWS2)}
          title="Click to view NEWS2 breakdown"
          className={`inline-flex items-center justify-center w-16 h-16 rounded-xl border-2 text-xl font-bold cursor-pointer transition-all hover:scale-105 flex-shrink-0 ${
            p.acuityScore >= 8 ? "bg-red-500/20 text-red-400 border-red-500 hover:bg-red-500/30" : p.acuityScore >= 6 ? "bg-amber-500/20 text-amber-400 border-amber-500 hover:bg-amber-500/30" : "bg-green-500/20 text-green-400 border-green-500 hover:bg-green-500/30"
          }`}
        >
          {p.acuityScore.toFixed(1)}
        </button>
      </div>

      {/* NEWS2 Clinical Score Breakdown Panel */}
      {showNEWS2 && (
        <div className="bg-gray-900 rounded-xl border border-cyan-500/30 p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-cyan-400 text-lg">NEWS2 Clinical Score Breakdown</h3>
            <button onClick={() => setShowNEWS2(false)} className="text-gray-500 hover:text-white text-sm">
              Close
            </button>
          </div>

          {/* Vital signs table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="text-left py-2 pr-4">Vital Sign</th>
                  <th className="text-left py-2 pr-4">Value</th>
                  <th className="text-left py-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {news2.vitalScores.map((vs) => (
                  <tr key={vs.label} className="border-b border-gray-800/50">
                    <td className="py-2 pr-4 text-gray-300">{vs.label}</td>
                    <td className="py-2 pr-4 font-mono">{vs.value}</td>
                    <td className="py-2">
                      <span className={`inline-flex items-center gap-1.5 ${
                        vs.score >= 3 ? "text-red-400" : vs.score >= 2 ? "text-amber-400" : vs.score >= 1 ? "text-yellow-400" : "text-green-400"
                      }`}>
                        <span className="font-bold">{vs.score}</span>
                        <span className="text-xs">({vs.status})</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Score summary */}
          <div className="border-t border-gray-700 pt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">NEWS2 Base Score</span>
              <span className="font-bold font-mono">{news2.news2Base}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Diagnosis Complexity ({p.icdCodes.length} ICD codes)</span>
              <span className="font-bold font-mono">+{diagComp}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Task Burden ({p.pendingTasks.length} tasks)</span>
              <span className="font-bold font-mono">+{taskBur}</span>
            </div>
            <div className="flex justify-between border-t border-gray-700 pt-2">
              <span className="font-semibold">TOTAL ACUITY</span>
              <span className={`font-bold text-lg ${levelColor}`}>
                {totalAcuity.toFixed(1)} ({levelLabel})
              </span>
            </div>
          </div>

          {/* qSOFA sepsis screening */}
          {qsofa.score > 0 && (
            <div className={`p-3 rounded-lg border ${
              qsofa.score >= 2 ? "bg-red-500/10 border-red-500/30" : "bg-amber-500/10 border-amber-500/30"
            }`}>
              <p className="font-semibold text-sm mb-2">
                {qsofa.score >= 2 ? "!! " : ""}Sepsis Screening (qSOFA): {qsofa.score}/3 criteria met
              </p>
              <div className="space-y-1 text-sm">
                {qsofa.criteria.map((c) => (
                  <div key={c.label} className="flex items-center gap-2">
                    <span className={c.met ? "text-red-400" : "text-gray-500"}>
                      {c.met ? "+" : "-"}
                    </span>
                    <span className={c.met ? "text-gray-200" : "text-gray-500"}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-gray-600 italic">
            Scoring follows modified NEWS2 (National Early Warning Score 2). Higher scores indicate greater clinical acuity.
            This is a decision-support tool — clinical judgment always takes precedence.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Vitals */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="font-semibold mb-3">Vital Signs</h3>
          <div className="space-y-2 text-sm">
            <VitalRow label="Heart Rate" value={`${p.vitals.heartRate} bpm`} warn={p.vitals.heartRate > 100 || p.vitals.heartRate < 60} />
            <VitalRow label="Blood Pressure" value={`${p.vitals.systolicBP}/${p.vitals.diastolicBP} mmHg`} warn={p.vitals.systolicBP > 160 || p.vitals.systolicBP < 90} />
            <VitalRow label="Temperature" value={`${p.vitals.temperature}°C`} warn={p.vitals.temperature > 38.0} />
            <VitalRow label="Resp Rate" value={`${p.vitals.respiratoryRate}/min`} warn={p.vitals.respiratoryRate > 22} />
            <VitalRow label="SpO2" value={`${p.vitals.spO2}%`} warn={p.vitals.spO2 < 94} />
            <VitalRow label="Pain" value={`${p.vitals.painLevel}/10`} warn={p.vitals.painLevel > 6} />
          </div>
        </div>

        {/* Medications */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="font-semibold mb-3">Medications</h3>
          <div className="space-y-2">
            {p.medications.map((m, i) => (
              <div key={i} className="text-sm p-2 bg-gray-800/50 rounded">
                <p className="font-medium">{m.name}</p>
                <p className="text-xs text-gray-400">{m.dosage} — {m.frequency}</p>
              </div>
            ))}
          </div>
          {p.allergies.length > 0 && (
            <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded">
              <p className="text-xs font-semibold text-red-400">ALLERGIES</p>
              <p className="text-sm text-red-300">{p.allergies.join(", ")}</p>
            </div>
          )}
        </div>

        {/* NFT / Blockchain Status */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="font-semibold mb-3">Blockchain Records</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Passport SBT</span>
              <span className={p.nftStatus.passportMinted ? "text-green-400" : "text-red-400"}>
                {p.nftStatus.passportMinted ? "Minted" : "Pending"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Record NFTs</span>
              <span className="text-cyan-400">{p.nftStatus.recordCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Active Grants</span>
              <span className="text-purple-400">{p.nftStatus.activeGrants}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Last Updated</span>
              <span className="text-gray-500 text-xs">{new Date(p.nftStatus.lastUpdated).toLocaleTimeString()}</span>
            </div>
            <div className="text-xs text-gray-600 mt-2 p-2 bg-gray-800/50 rounded font-mono break-all">
              ICD: {p.icdCodes.join(", ")}
            </div>
          </div>
        </div>
      </div>

      {/* MediScribe Voice-to-Chart */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <h3 className="font-semibold">MediScribe — Voice-to-Chart</h3>
          <button
            onClick={simulateTranscription}
            disabled={isRecording}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isRecording
                ? "bg-red-500 text-white animate-pulse"
                : "bg-cyan-500 text-white hover:bg-cyan-600"
            }`}
          >
            {isRecording ? "Recording..." : "Start Recording"}
          </button>
        </div>
        {soapNote && (
          <div className="mt-3">
            <pre className="text-sm bg-gray-800 p-4 rounded-lg whitespace-pre-wrap font-mono text-gray-300 max-h-80 overflow-auto">
              {soapNote}
            </pre>
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                Sign & Mint Record NFT
              </button>
              <button className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-600">
                Edit Draft
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pending Tasks */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h3 className="font-semibold mb-3">Pending Tasks</h3>
        <div className="space-y-2">
          {p.pendingTasks.map((t, i) => (
            <div key={i} className="flex items-center justify-between p-2 bg-gray-800/50 rounded text-sm gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  t.priority === "critical" ? "bg-red-500" : t.priority === "urgent" ? "bg-amber-500" : "bg-green-500"
                }`} />
                <span className="text-gray-300 truncate">{t.description}</span>
              </div>
              <span className="text-xs text-gray-500 flex-shrink-0">{new Date(t.scheduledTime).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VitalRow({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={warn ? "text-red-400 font-medium" : "text-gray-200"}>{value}</span>
    </div>
  );
}
