import { Nurse, Patient, NursingTask, NurseAssignment, ScheduledTask } from './types';

/**
 * NurseRouter — Optimizes nurse-to-patient assignments and task routing.
 *
 * Solves a modified Vehicle Routing Problem (VRP):
 * - Nurses are "vehicles" with capacity constraints
 * - Patients are "stops" with time windows (medication schedules)
 * - Objective: minimize walk distance + task delay + acuity mismatch
 *
 * In production, this uses Google OR-Tools (Python) constraint solver.
 * For the prototype, we use a greedy heuristic that demonstrates the concept.
 */
export class NurseRouter {
  /** Generate optimized assignments for all nurses on a shift */
  static generateAssignments(
    nurses: Nurse[],
    patients: Patient[]
  ): NurseAssignment[] {
    // 1. Sort patients by acuity (highest first)
    const sortedPatients = [...patients].sort(
      (a, b) => b.acuityScore - a.acuityScore
    );

    // 2. Assign patients to nurses using greedy best-fit
    const assignments = new Map<string, string[]>(); // nurseId -> patientIds
    for (const nurse of nurses) {
      assignments.set(nurse.id, []);
    }

    for (const patient of sortedPatients) {
      const bestNurse = this.findBestNurse(patient, nurses, assignments);
      if (bestNurse) {
        assignments.get(bestNurse.id)!.push(patient.id);
      }
    }

    // 3. Generate task queues for each nurse
    return nurses.map((nurse) => {
      const patientIds = assignments.get(nurse.id) ?? [];
      const nursePatients = patientIds
        .map((id) => patients.find((p) => p.id === id)!)
        .filter(Boolean);

      const taskQueue = this.optimizeTaskRoute(nurse, nursePatients);
      const totalWalkDistance = taskQueue.reduce(
        (sum, t) => sum + t.walkDistanceFromPrevious,
        0
      );
      const workloadScore = this.calculateWorkload(nursePatients);

      return {
        nurseId: nurse.id,
        taskQueue,
        totalWalkDistance,
        estimatedCompletionTime: taskQueue.length > 0
          ? taskQueue[taskQueue.length - 1].estimatedStartTime
          : nurse.shiftStart,
        workloadScore,
      };
    });
  }

  /** Find the best nurse for a patient based on constraints */
  private static findBestNurse(
    patient: Patient,
    nurses: Nurse[],
    assignments: Map<string, string[]>
  ): Nurse | null {
    let bestNurse: Nurse | null = null;
    let bestScore = -Infinity;

    for (const nurse of nurses) {
      const assignedCount = assignments.get(nurse.id)?.length ?? 0;

      // Constraint: max patients per nurse
      if (assignedCount >= nurse.maxPatients) continue;

      // Constraint: certification requirements
      const requiredCerts = patient.pendingTasks.flatMap((t) => t.requiredCerts);
      const hasCerts = requiredCerts.every((cert) =>
        nurse.certifications.includes(cert)
      );
      if (!hasCerts) continue;

      // Constraint: same floor preferred
      const sameFloor = nurse.currentFloor === patient.floor ? 1 : 0;

      // Score: prefer fewer current patients + same floor + lower workload
      const score = (nurse.maxPatients - assignedCount) * 2 + sameFloor * 3;

      if (score > bestScore) {
        bestScore = score;
        bestNurse = nurse;
      }
    }

    return bestNurse;
  }

  /** Optimize task order using nearest-neighbor heuristic */
  private static optimizeTaskRoute(
    nurse: Nurse,
    patients: Patient[]
  ): ScheduledTask[] {
    // Collect all pending tasks
    const allTasks: NursingTask[] = patients.flatMap((p) =>
      p.pendingTasks.filter((t) => !t.completedAt)
    );

    // Sort by priority first, then by scheduled time
    const priorityOrder = { critical: 0, urgent: 1, routine: 2, low: 3 };
    allTasks.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime();
    });

    // Build scheduled task queue with routing
    let currentLocation = nurse.currentLocation;
    let currentTime = new Date(nurse.shiftStart).getTime();

    return allTasks.map((task, index) => {
      const patient = patients.find((p) => p.id === task.patientId);
      const patientRoom = patient?.room ?? 'unknown';

      // Estimate walk distance (simplified — in production use floor plan graph)
      const walkDistance = this.estimateDistance(
        currentLocation,
        this.roomToLocation(patientRoom, patient?.floor ?? 1)
      );
      const walkTimeMs = (walkDistance / 50) * 60 * 1000; // ~50m/min walk speed

      const estimatedStart = new Date(currentTime + walkTimeMs);

      // Update state for next iteration
      currentLocation = this.roomToLocation(patientRoom, patient?.floor ?? 1);
      currentTime = estimatedStart.getTime() + task.estimatedMinutes * 60 * 1000;

      return {
        ...task,
        assignedNurseId: nurse.id,
        routeOrder: index + 1,
        estimatedStartTime: estimatedStart.toISOString(),
        walkDistanceFromPrevious: Math.round(walkDistance),
      };
    });
  }

  /** Calculate workload score for a set of patients (0-10) */
  private static calculateWorkload(patients: Patient[]): number {
    if (patients.length === 0) return 0;

    const avgAcuity =
      patients.reduce((sum, p) => sum + p.acuityScore, 0) / patients.length;
    const totalTasks = patients.reduce(
      (sum, p) => sum + p.pendingTasks.filter((t) => !t.completedAt).length,
      0
    );
    const hasIsolation = patients.some((p) => p.isolationRequired);

    let score = avgAcuity * 0.5 + Math.min(5, totalTasks * 0.3);
    if (hasIsolation) score += 1;

    return Math.min(10, Math.round(score * 10) / 10);
  }

  /** Estimate distance between two points (meters) */
  private static estimateDistance(
    a: { x: number; y: number; floor: number },
    b: { x: number; y: number; floor: number }
  ): number {
    const horizontalDist = Math.sqrt(
      Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2)
    );
    const floorDist = Math.abs(b.floor - a.floor) * 30; // 30m per floor via elevator
    return horizontalDist + floorDist;
  }

  /** Convert room number to approximate coordinates */
  private static roomToLocation(
    room: string,
    floor: number
  ): { x: number; y: number; floor: number } {
    // Simple mapping: room number → position along hallway
    const roomNum = parseInt(room.replace(/\D/g, ''), 10) || 0;
    const roomInHall = roomNum % 100;
    return {
      x: (roomInHall % 20) * 5, // 5m between rooms
      y: roomInHall > 20 ? 15 : 0, // two sides of hallway
      floor,
    };
  }
}
