"use client";

import { useState } from "react";
import { HospitalOverview } from "./components/HospitalOverview";
import { PatientList } from "./components/PatientList";
import { NurseAssignments } from "./components/NurseAssignments";
import { AlertCenter } from "./components/AlertCenter";
import { PatientDetail } from "./components/PatientDetail";
import { BlockchainStatus } from "./components/BlockchainStatus";
import { AboutMediHive } from "./components/AboutMediHive";
import { usePatients, useNurses, useDashboardMetrics, useDataSource } from "./hooks/useFirestore";
import type { MockData } from "./data/mock-hospital";

export default function Dashboard() {
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "patients" | "nurses" | "alerts" | "blockchain" | "about">("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { patients } = usePatients();
  const { nurses } = useNurses();
  const { metrics } = useDashboardMetrics();
  const dataSource = useDataSource();

  const dashboardData: MockData = {
    patients,
    nurses,
    hospitalMetrics: metrics,
  };

  const tabs = [
    { id: "overview" as const, label: "Command Center", icon: "🏥" },
    { id: "patients" as const, label: "Patients", icon: "🩺" },
    { id: "nurses" as const, label: "Nurse Routing", icon: "👩‍⚕️" },
    { id: "alerts" as const, label: "Alert Triage", icon: "🔔" },
    { id: "blockchain" as const, label: "Blockchain", icon: "⛓️" },
    { id: "about" as const, label: "About MediHive", icon: "📋" },
  ];

  return (
    <div className="flex h-screen relative">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-gray-900 border-r border-gray-800 flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          md:relative md:translate-x-0 md:z-auto
        `}
      >
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              MediPulse
            </h1>
            <p className="text-xs text-gray-500 mt-1">Medi-Hive Command Center</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-gray-400 hover:text-white p-1"
            aria-label="Close sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedPatient(null); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                activeTab === tab.id
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800 space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
            <div className="w-6 h-6 rounded-full bg-cyan-500/30 flex items-center justify-center text-xs font-bold text-cyan-300">A</div>
            <div>
              <p className="text-xs font-medium text-cyan-300">Dr. Admin</p>
              <p className="text-[10px] text-gray-500">Hospital Administrator</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${dataSource === "firestore" ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
            <span className="text-xs text-gray-500">
              {dataSource === "firestore" ? "Firestore Live" : "Mock Data"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-500">Solana Devnet</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs text-gray-500">FHIR R4 Sandbox</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {/* Mobile header with hamburger */}
        <div className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-3 flex items-center gap-3 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-white p-1"
            aria-label="Open sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            MediPulse
          </h1>
          <span className="text-xs text-gray-500 ml-auto">
            {tabs.find((t) => t.id === activeTab)?.label}
          </span>
        </div>

        <div className="p-4 md:p-6">
          {selectedPatient ? (
            <PatientDetail patient={patients.find((p) => p.id === selectedPatient)!} onBack={() => setSelectedPatient(null)} />
          ) : activeTab === "overview" ? (
            <HospitalOverview data={dashboardData} onSelectPatient={setSelectedPatient} />
          ) : activeTab === "patients" ? (
            <PatientList patients={patients} onSelectPatient={setSelectedPatient} />
          ) : activeTab === "nurses" ? (
            <NurseAssignments nurses={nurses} patients={patients} />
          ) : activeTab === "alerts" ? (
            <AlertCenter patients={patients} />
          ) : activeTab === "blockchain" ? (
            <BlockchainStatus />
          ) : (
            <AboutMediHive />
          )}
        </div>
      </main>
    </div>
  );
}
