"use client";

import { useState, useEffect } from "react";
import { MOCK_DATA, type MockPatient, type MockNurse, type MockData } from "../data/mock-hospital";
import {
  subscribePatients,
  subscribeNurses,
  subscribeAlerts,
  getPatientDetail,
  getDashboardMetrics,
} from "../lib/firestore";

// ── Connection state shared across hooks ──

export type DataSource = "firestore" | "mock";

let globalSource: DataSource = "mock";
const sourceListeners = new Set<(s: DataSource) => void>();

function setGlobalSource(s: DataSource) {
  if (globalSource !== s) {
    globalSource = s;
    sourceListeners.forEach((fn) => fn(s));
  }
}

/** Hook that returns current data source ("firestore" | "mock"). */
export function useDataSource(): DataSource {
  const [source, setSource] = useState<DataSource>(globalSource);
  useEffect(() => {
    const handler = (s: DataSource) => setSource(s);
    sourceListeners.add(handler);
    return () => { sourceListeners.delete(handler); };
  }, []);
  return source;
}

// ── usePatients ──

export function usePatients() {
  const [patients, setPatients] = useState<MockPatient[]>(MOCK_DATA.patients);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribePatients(
      (firestorePatients) => {
        if (firestorePatients.length > 0) {
          setPatients(firestorePatients);
          setGlobalSource("firestore");
        }
        // Empty collection — keep mock data (already initialized)
        setError(null);
      },
      (err) => {
        console.warn("[MediPulse] Firestore unavailable, using mock data:", err.message);
        setError(err);
      }
    );

    return () => { unsub(); };
  }, []);

  return { patients, loading, error };
}

// ── useNurses ──

export function useNurses() {
  const [nurses, setNurses] = useState<MockNurse[]>(MOCK_DATA.nurses);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribeNurses(
      (firestoreNurses) => {
        if (firestoreNurses.length > 0) {
          setNurses(firestoreNurses);
          setGlobalSource("firestore");
        }
        // Empty collection — keep mock data (already initialized)
        setError(null);
      },
      (err) => {
        console.warn("[MediPulse] Nurses fallback to mock:", err.message);
        setError(err);
      }
    );

    return () => { unsub(); };
  }, []);

  return { nurses, loading, error };
}

// ── useAlerts ──

export function useAlerts() {
  // Initialize with mock alerts immediately to avoid loading flash
  const initialMockAlerts = MOCK_DATA.patients.flatMap((p) =>
    p.alerts
      .filter((a) => !a.acknowledged)
      .map((a) => ({ ...a, patientId: p.id, patientName: p.name, room: p.room }))
  );

  const [alerts, setAlerts] = useState<
    Array<MockPatient["alerts"][0] & { patientId: string; patientName: string; room: string }>
  >(initialMockAlerts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribeAlerts(
      (firestoreAlerts) => {
        if (firestoreAlerts.length > 0) {
          setAlerts(firestoreAlerts);
        }
        // Empty collection — keep mock data (already initialized)
        setError(null);
      },
      (err) => {
        console.warn("[MediPulse] Alerts fallback to mock:", err.message);
        setError(err);
      }
    );

    return () => { unsub(); };
  }, []);

  return { alerts, loading, error };
}

// ── usePatientDetail ──

export function usePatientDetail(patientId: string | null) {
  const [patient, setPatient] = useState<MockPatient | null>(null);
  const [vitals, setVitals] = useState<Array<MockPatient["vitals"] & { recordedAt: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!patientId) {
      setPatient(null);
      setVitals([]);
      return;
    }

    setLoading(true);

    getPatientDetail(patientId)
      .then((result) => {
        if (result) {
          setPatient(result.patient);
          setVitals(result.vitalsHistory);
          setGlobalSource("firestore");
        } else {
          // Not found in Firestore — use mock
          const mockPatient = MOCK_DATA.patients.find((p) => p.id === patientId) ?? null;
          setPatient(mockPatient);
          setVitals([]);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.warn("[MediPulse] PatientDetail fallback to mock:", err.message);
        const mockPatient = MOCK_DATA.patients.find((p) => p.id === patientId) ?? null;
        setPatient(mockPatient);
        setVitals([]);
        setError(err);
        setLoading(false);
      });
  }, [patientId]);

  return { patient, vitals, loading, error };
}

// ── useDashboardMetrics ──

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<MockData["hospitalMetrics"]>(MOCK_DATA.hospitalMetrics);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    getDashboardMetrics()
      .then((result) => {
        if (result) {
          setMetrics(result);
          setGlobalSource("firestore");
        }
        // No result — keep mock data (already initialized)
      })
      .catch((err) => {
        console.warn("[MediPulse] Metrics fallback to mock:", err.message);
        setError(err);
      });
  }, []);

  return { metrics, loading, error };
}
