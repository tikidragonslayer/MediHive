/**
 * Firestore client for MediPulse dashboard.
 *
 * Connects to Firestore for real-time hospital data.
 * Falls back gracefully when Firestore is unavailable (mock data used by hooks).
 *
 * Env vars:
 *   NEXT_PUBLIC_FIREBASE_CONFIG — JSON string of Firebase config (optional, has default)
 *   NEXT_PUBLIC_USE_EMULATOR   — "true" to connect to local Firestore emulator
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDoc,
  getDocs,
  type Firestore,
  type Unsubscribe,
  connectFirestoreEmulator,
  Timestamp,
} from "firebase/firestore";
import type { MockPatient, MockNurse, MockData } from "../data/mock-hospital";

// ── Firebase Config ──

const DEFAULT_CONFIG = {
  apiKey: "demo-medihive-key",
  authDomain: "medihive-demo.firebaseapp.com",
  projectId: "medihive-demo",
  storageBucket: "medihive-demo.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000",
};

function getFirebaseConfig() {
  const envConfig = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;
  if (envConfig) {
    try {
      return JSON.parse(envConfig);
    } catch {
      console.warn("[MediPulse] Invalid NEXT_PUBLIC_FIREBASE_CONFIG, using default");
    }
  }
  return DEFAULT_CONFIG;
}

let app: FirebaseApp;
let db: Firestore;
let emulatorConnected = false;

function getDb(): Firestore {
  if (!db) {
    const existing = getApps();
    app = existing.length > 0 ? existing[0] : initializeApp(getFirebaseConfig());
    db = getFirestore(app);

    if (
      process.env.NEXT_PUBLIC_USE_EMULATOR === "true" &&
      !emulatorConnected
    ) {
      connectFirestoreEmulator(db, "localhost", 8080);
      emulatorConnected = true;
      console.info("[MediPulse] Connected to Firestore emulator on localhost:8080");
    }
  }
  return db;
}

// ── Helpers ──

/** Convert Firestore Timestamps to ISO strings recursively */
function normalizeTimestamps<T>(data: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Timestamp) {
      result[key] = value.toDate().toISOString();
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? normalizeTimestamps(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object" && value !== null) {
      result[key] = normalizeTimestamps(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

// ── Subscription Functions ──

/**
 * Subscribe to patients collection, sorted by acuity DESC.
 * Returns an unsubscribe function.
 */
export function subscribePatients(
  callback: (patients: MockPatient[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const firestore = getDb();
  const q = query(
    collection(firestore, "patients"),
    orderBy("acuityScore", "desc")
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const patients = snapshot.docs.map((d) =>
        normalizeTimestamps<MockPatient>({ id: d.id, ...d.data() })
      );
      callback(patients);
    },
    (error) => {
      console.error("[MediPulse] subscribePatients error:", error.message);
      onError?.(error);
    }
  );
}

/**
 * Subscribe to nurses collection.
 * Returns an unsubscribe function.
 */
export function subscribeNurses(
  callback: (nurses: MockNurse[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const firestore = getDb();
  const q = query(collection(firestore, "nurses"));

  return onSnapshot(
    q,
    (snapshot) => {
      const nurses = snapshot.docs.map((d) =>
        normalizeTimestamps<MockNurse>({ id: d.id, ...d.data() })
      );
      callback(nurses);
    },
    (error) => {
      console.error("[MediPulse] subscribeNurses error:", error.message);
      onError?.(error);
    }
  );
}

/**
 * Subscribe to unacknowledged alerts across all patients.
 * Returns an unsubscribe function.
 */
export function subscribeAlerts(
  callback: (alerts: Array<MockPatient["alerts"][0] & { patientId: string; patientName: string; room: string }>) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const firestore = getDb();
  const q = query(
    collection(firestore, "alerts"),
    where("acknowledged", "==", false),
    orderBy("time", "desc")
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const alerts = snapshot.docs.map((d) =>
        normalizeTimestamps<MockPatient["alerts"][0] & { patientId: string; patientName: string; room: string }>({
          id: d.id,
          ...d.data(),
        })
      );
      callback(alerts);
    },
    (error) => {
      console.error("[MediPulse] subscribeAlerts error:", error.message);
      onError?.(error);
    }
  );
}

/**
 * Subscribe to beds collection.
 * Returns an unsubscribe function.
 */
export function subscribeBeds(
  callback: (beds: Array<{ id: string; room: string; floor: number; status: string; patientId?: string }>) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const firestore = getDb();
  const q = query(collection(firestore, "beds"));

  return onSnapshot(
    q,
    (snapshot) => {
      const beds = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Array<{ id: string; room: string; floor: number; status: string; patientId?: string }>;
      callback(beds);
    },
    (error) => {
      console.error("[MediPulse] subscribeBeds error:", error.message);
      onError?.(error);
    }
  );
}

/**
 * Subscribe to the last 48 vitals readings for a patient.
 * Returns an unsubscribe function.
 */
export function subscribeVitals(
  patientId: string,
  callback: (vitals: Array<MockPatient["vitals"] & { recordedAt: string }>) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const firestore = getDb();
  const q = query(
    collection(firestore, "patients", patientId, "vitals"),
    orderBy("recordedAt", "desc"),
    limit(48)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const vitals = snapshot.docs.map((d) =>
        normalizeTimestamps<MockPatient["vitals"] & { recordedAt: string }>({
          id: d.id,
          ...d.data(),
        })
      );
      callback(vitals);
    },
    (error) => {
      console.error("[MediPulse] subscribeVitals error:", error.message);
      onError?.(error);
    }
  );
}

/**
 * Subscribe to tasks for a specific nurse.
 * Returns an unsubscribe function.
 */
export function subscribeTasks(
  nurseId: string,
  callback: (tasks: MockPatient["pendingTasks"]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const firestore = getDb();
  const q = query(
    collection(firestore, "tasks"),
    where("assignedNurse", "==", nurseId),
    where("completedAt", "==", null),
    orderBy("scheduledTime", "asc")
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const tasks = snapshot.docs.map((d) =>
        normalizeTimestamps<MockPatient["pendingTasks"][0]>({
          id: d.id,
          ...d.data(),
        })
      );
      callback(tasks);
    },
    (error) => {
      console.error("[MediPulse] subscribeTasks error:", error.message);
      onError?.(error);
    }
  );
}

/**
 * Get full patient detail: patient doc + subcollection vitals + meds + alerts.
 */
export async function getPatientDetail(
  patientId: string
): Promise<{
  patient: MockPatient;
  vitalsHistory: Array<MockPatient["vitals"] & { recordedAt: string }>;
} | null> {
  const firestore = getDb();

  const patientDoc = await getDoc(doc(firestore, "patients", patientId));
  if (!patientDoc.exists()) return null;

  const patient = normalizeTimestamps<MockPatient>({
    id: patientDoc.id,
    ...patientDoc.data(),
  });

  const vitalsSnap = await getDocs(
    query(
      collection(firestore, "patients", patientId, "vitals"),
      orderBy("recordedAt", "desc"),
      limit(48)
    )
  );

  const vitalsHistory = vitalsSnap.docs.map((d) =>
    normalizeTimestamps<MockPatient["vitals"] & { recordedAt: string }>({
      id: d.id,
      ...d.data(),
    })
  );

  return { patient, vitalsHistory };
}

/**
 * Get aggregated dashboard metrics from Firestore.
 */
export async function getDashboardMetrics(): Promise<MockData["hospitalMetrics"] | null> {
  const firestore = getDb();

  const metricsDoc = await getDoc(doc(firestore, "metrics", "hospital"));
  if (!metricsDoc.exists()) return null;

  return normalizeTimestamps<MockData["hospitalMetrics"]>(metricsDoc.data() as Record<string, unknown>);
}
