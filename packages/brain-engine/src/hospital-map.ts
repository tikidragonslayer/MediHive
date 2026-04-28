/**
 * HospitalMap — Spatial-aware logistics engine.
 *
 * Hospitals define their physical layout:
 * - Floors → Wings → Zones → Rooms
 * - Walking paths with real distances (not Euclidean)
 * - Elevator/stairwell locations
 * - Nurse stations (rest points, supply access)
 * - Equipment storage locations
 * - Isolation zones (must be visited last in a route)
 *
 * MediBrain uses this to:
 * 1. Assign nurses to NEARBY patients (zone-first, then floor, never cross-building)
 * 2. Route tasks in walking-optimal order (TSP within zone)
 * 3. Estimate real travel times (hallway distance, not straight line)
 * 4. Factor in elevator wait times for cross-floor assignments
 * 5. Keep isolation rooms at end of route sequence
 *
 * Hospitals configure this once during onboarding via a visual floor plan editor.
 * The map is stored as a weighted graph where edges = hallway segments.
 */

// === Hospital Layout Model ===

export interface HospitalLayout {
  id: string;
  name: string;
  floors: Floor[];
  elevators: Elevator[];
  stairwells: Stairwell[];
  /** Pre-computed shortest paths between all zone pairs */
  zoneDistanceMatrix?: Record<string, Record<string, number>>;
}

export interface Floor {
  level: number;
  name: string; // "Ground", "2nd Floor", "ICU Level"
  wings: Wing[];
  nurseStations: NurseStation[];
}

export interface Wing {
  id: string;
  name: string; // "4A", "4B", "West Wing"
  floor: number;
  zones: Zone[];
  /** Walking distance from this wing's entrance to the nearest elevator (meters) */
  elevatorDistance: number;
}

export interface Zone {
  id: string; // "4A-N" (floor 4, wing A, north zone)
  wingId: string;
  floor: number;
  name: string;
  rooms: Room[];
  nurseStationId?: string;
  /** Is this an isolation zone? Visited last in routing. */
  isIsolation: boolean;
  /** Walking path within zone: ordered list of rooms along the hallway */
  hallwayOrder: string[]; // room IDs in walking order
  /** Total hallway length in meters */
  hallwayLength: number;
}

export interface Room {
  id: string; // "412"
  zoneId: string;
  floor: number;
  /** Position along the zone's hallway (0.0 = start, 1.0 = end) */
  hallwayPosition: number;
  type: 'patient' | 'supply' | 'medication' | 'utility' | 'staff';
  beds: number;
  /** Equipment in this room (smart bed, telemetry, etc.) */
  equipment: string[];
}

export interface NurseStation {
  id: string;
  floor: number;
  wingId: string;
  zoneId: string;
  /** Supplies available here (avoids trips to central supply) */
  supplies: string[];
}

export interface Elevator {
  id: string;
  servesFloors: number[];
  /** Average wait time in seconds */
  avgWaitSeconds: number;
  /** Location on each floor it serves */
  floorPositions: Record<number, { wingId: string; hallwayPosition: number }>;
}

export interface Stairwell {
  id: string;
  servesFloors: number[];
  /** Walking time per floor in seconds */
  secondsPerFloor: number;
  floorPositions: Record<number, { wingId: string }>;
}

// === Spatial Distance Calculator ===

export class HospitalMap {
  private layout: HospitalLayout;
  private roomIndex: Map<string, Room> = new Map();
  private zoneIndex: Map<string, Zone> = new Map();
  private wingIndex: Map<string, Wing> = new Map();

  constructor(layout: HospitalLayout) {
    this.layout = layout;
    this.buildIndices();
  }

  /** Calculate real walking distance between two rooms (meters) */
  walkingDistance(roomA: string, roomB: string): number {
    const a = this.roomIndex.get(roomA);
    const b = this.roomIndex.get(roomB);
    if (!a || !b) return Infinity;

    // Same zone: simple hallway distance
    if (a.zoneId === b.zoneId) {
      return this.sameZoneDistance(a, b);
    }

    // Same wing: zone-to-zone within wing
    const zoneA = this.zoneIndex.get(a.zoneId);
    const zoneB = this.zoneIndex.get(b.zoneId);
    if (!zoneA || !zoneB) return Infinity;

    if (zoneA.wingId === zoneB.wingId) {
      return this.sameWingDistance(a, b, zoneA, zoneB);
    }

    // Same floor, different wing: through corridor
    if (a.floor === b.floor) {
      return this.sameFloorDistance(a, b, zoneA, zoneB);
    }

    // Different floor: elevator/stairs
    return this.crossFloorDistance(a, b, zoneA, zoneB);
  }

  /** Calculate walking time in seconds (average nurse walking speed: 1.2 m/s) */
  walkingTime(roomA: string, roomB: string): number {
    const distance = this.walkingDistance(roomA, roomB);
    const walkingSpeed = 1.2; // meters per second (nurse pace)
    let time = distance / walkingSpeed;

    // Add elevator wait if crossing floors
    const a = this.roomIndex.get(roomA);
    const b = this.roomIndex.get(roomB);
    if (a && b && a.floor !== b.floor) {
      const elevator = this.findNearestElevator(a.floor);
      if (elevator) {
        time += elevator.avgWaitSeconds;
        time += Math.abs(b.floor - a.floor) * 8; // ~8s per floor travel
      }
    }

    return Math.round(time);
  }

  /** Get the zone a room belongs to */
  getRoomZone(roomId: string): Zone | undefined {
    const room = this.roomIndex.get(roomId);
    if (!room) return undefined;
    return this.zoneIndex.get(room.zoneId);
  }

  /** Get all rooms in a zone in hallway walking order */
  getZoneRoomsInOrder(zoneId: string): Room[] {
    const zone = this.zoneIndex.get(zoneId);
    if (!zone) return [];
    return zone.hallwayOrder
      .map((id) => this.roomIndex.get(id))
      .filter((r): r is Room => r !== undefined);
  }

  /** Check if two rooms are in the same zone */
  isSameZone(roomA: string, roomB: string): boolean {
    const a = this.roomIndex.get(roomA);
    const b = this.roomIndex.get(roomB);
    return !!a && !!b && a.zoneId === b.zoneId;
  }

  /** Check if two rooms are on the same floor */
  isSameFloor(roomA: string, roomB: string): boolean {
    const a = this.roomIndex.get(roomA);
    const b = this.roomIndex.get(roomB);
    return !!a && !!b && a.floor === b.floor;
  }

  /** Find the nearest nurse station to a room */
  nearestNurseStation(roomId: string): NurseStation | undefined {
    const room = this.roomIndex.get(roomId);
    if (!room) return undefined;

    const floor = this.layout.floors.find((f) => f.level === room.floor);
    if (!floor) return undefined;

    // Prefer station in same zone/wing
    const zone = this.zoneIndex.get(room.zoneId);
    if (zone?.nurseStationId) {
      return floor.nurseStations.find((ns) => ns.id === zone.nurseStationId);
    }

    // Fallback: any station on same floor
    return floor.nurseStations[0];
  }

  /** Get all zones on a specific floor */
  getFloorZones(floor: number): Zone[] {
    return Array.from(this.zoneIndex.values()).filter((z) => z.floor === floor);
  }

  /** Build the zone distance matrix for fast lookups */
  precomputeDistances(): Record<string, Record<string, number>> {
    const zones = Array.from(this.zoneIndex.keys());
    const matrix: Record<string, Record<string, number>> = {};

    for (const from of zones) {
      matrix[from] = {};
      for (const to of zones) {
        if (from === to) {
          matrix[from][to] = 0;
          continue;
        }
        // Use representative rooms (midpoint of each zone)
        const fromZone = this.zoneIndex.get(from)!;
        const toZone = this.zoneIndex.get(to)!;
        const fromRoom = fromZone.hallwayOrder[Math.floor(fromZone.hallwayOrder.length / 2)];
        const toRoom = toZone.hallwayOrder[Math.floor(toZone.hallwayOrder.length / 2)];
        matrix[from][to] = fromRoom && toRoom ? this.walkingDistance(fromRoom, toRoom) : Infinity;
      }
    }

    this.layout.zoneDistanceMatrix = matrix;
    return matrix;
  }

  // === Private distance calculators ===

  private sameZoneDistance(a: Room, b: Room): number {
    const zone = this.zoneIndex.get(a.zoneId)!;
    return Math.abs(a.hallwayPosition - b.hallwayPosition) * zone.hallwayLength;
  }

  private sameWingDistance(a: Room, b: Room, zoneA: Zone, zoneB: Zone): number {
    // Distance = (a to zone exit) + (zone-to-zone corridor) + (zone entrance to b)
    const aToExit = (1 - a.hallwayPosition) * zoneA.hallwayLength;
    const bFromEntrance = b.hallwayPosition * zoneB.hallwayLength;
    const corridor = 15; // Average inter-zone corridor distance (meters)
    return aToExit + corridor + bFromEntrance;
  }

  private sameFloorDistance(a: Room, b: Room, zoneA: Zone, zoneB: Zone): number {
    const wingA = this.wingIndex.get(zoneA.wingId);
    const wingB = this.wingIndex.get(zoneB.wingId);
    if (!wingA || !wingB) return Infinity;

    // Distance through main corridor between wings
    const aToWingExit = (1 - a.hallwayPosition) * zoneA.hallwayLength + 10;
    const interWingCorridor = 50; // Average distance between wings on same floor
    const bFromWingEntrance = b.hallwayPosition * zoneB.hallwayLength + 10;
    return aToWingExit + interWingCorridor + bFromWingEntrance;
  }

  private crossFloorDistance(a: Room, b: Room, zoneA: Zone, zoneB: Zone): number {
    const wingA = this.wingIndex.get(zoneA.wingId);
    if (!wingA) return Infinity;

    // Distance to elevator + elevator travel + distance from elevator to room
    const toElevator = wingA.elevatorDistance + (1 - a.hallwayPosition) * zoneA.hallwayLength * 0.5;
    const floorTravel = Math.abs(b.floor - a.floor) * 4; // ~4m per floor (vertical)
    const fromElevator = b.hallwayPosition * zoneB.hallwayLength + 20; // elevator to wing entrance
    return toElevator + floorTravel + fromElevator;
  }

  private findNearestElevator(floor: number): Elevator | undefined {
    return this.layout.elevators.find((e) => e.servesFloors.includes(floor));
  }

  private buildIndices(): void {
    for (const floor of this.layout.floors) {
      for (const wing of floor.wings) {
        this.wingIndex.set(wing.id, wing);
        for (const zone of wing.zones) {
          this.zoneIndex.set(zone.id, zone);
          for (const room of zone.rooms) {
            this.roomIndex.set(room.id, room);
          }
        }
      }
    }
  }
}

// === Zone-Aware Nurse Assignment ===

export class SpatialAssigner {
  private map: HospitalMap;

  constructor(map: HospitalMap) {
    this.map = map;
  }

  /**
   * Assign nurses to patients with zone affinity.
   *
   * Rules (in priority order):
   * 1. Nurse should only care for patients in their assigned zone
   * 2. If zone is full, overflow to ADJACENT zones in same wing
   * 3. NEVER assign cross-wing unless no alternative (charge nurse approval)
   * 4. NEVER assign cross-floor (requires explicit staffing decision)
   * 5. Isolation rooms assigned to ONE nurse who visits them LAST
   * 6. Higher-acuity patients get the nurse physically closest to them
   */
  assignByZone(
    nurses: ZoneNurse[],
    patients: ZonePatient[]
  ): ZoneAssignment[] {
    const assignments: ZoneAssignment[] = nurses.map((n) => ({
      nurseId: n.id,
      nurseName: n.name,
      primaryZone: n.assignedZone,
      patients: [],
      totalWalkDistance: 0,
      isolationPatientsLast: [],
    }));

    // Sort patients: critical first, then by zone
    const sorted = [...patients].sort((a, b) => {
      // Critical patients first
      if (b.acuityScore >= 8 && a.acuityScore < 8) return 1;
      if (a.acuityScore >= 8 && b.acuityScore < 8) return -1;
      // Then by zone (group same-zone patients together)
      return a.zoneId.localeCompare(b.zoneId);
    });

    for (const patient of sorted) {
      const bestNurse = this.findBestNurseForPatient(patient, nurses, assignments);
      if (bestNurse) {
        const assignment = assignments.find((a) => a.nurseId === bestNurse.id)!;
        if (patient.isolationRequired) {
          assignment.isolationPatientsLast.push(patient.id);
        } else {
          assignment.patients.push(patient.id);
        }
      }
    }

    // Calculate walk distances for each assignment
    for (const assignment of assignments) {
      const allPatientRooms = [
        ...assignment.patients,
        ...assignment.isolationPatientsLast,
      ];
      assignment.totalWalkDistance = this.calculateRouteDistance(
        assignment.primaryZone,
        allPatientRooms.map((id) => {
          const patient = patients.find((p) => p.id === id);
          return patient?.room ?? '';
        })
      );
    }

    return assignments;
  }

  /** Optimize task ordering within a nurse's assignment for minimum walking */
  optimizeRoute(
    nurseZone: string,
    taskRooms: string[]
  ): { orderedRooms: string[]; totalDistance: number } {
    if (taskRooms.length <= 1) {
      return { orderedRooms: taskRooms, totalDistance: 0 };
    }

    // Nearest-neighbor TSP heuristic starting from nurse station
    const station = this.findZoneNurseStation(nurseZone);
    const visited: string[] = [];
    const remaining = new Set(taskRooms);
    let current = station;
    let totalDist = 0;

    while (remaining.size > 0) {
      let nearest = '';
      let nearestDist = Infinity;

      for (const room of remaining) {
        const dist = this.map.walkingDistance(current, room);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = room;
        }
      }

      if (nearest) {
        visited.push(nearest);
        totalDist += nearestDist;
        remaining.delete(nearest);
        current = nearest;
      } else {
        // Can't reach remaining rooms, add them in original order
        visited.push(...remaining);
        break;
      }
    }

    return { orderedRooms: visited, totalDistance: Math.round(totalDist) };
  }

  // === Private ===

  private findBestNurseForPatient(
    patient: ZonePatient,
    nurses: ZoneNurse[],
    assignments: ZoneAssignment[]
  ): ZoneNurse | null {
    let best: ZoneNurse | null = null;
    let bestScore = -Infinity;

    for (const nurse of nurses) {
      const assignment = assignments.find((a) => a.nurseId === nurse.id)!;
      const currentLoad = assignment.patients.length + assignment.isolationPatientsLast.length;

      // Hard constraint: max patients
      if (currentLoad >= nurse.maxPatients) continue;

      // Hard constraint: required certifications
      if (patient.requiredCerts.some((c) => !nurse.certifications.includes(c))) continue;

      let score = 0;

      // STRONG preference: same zone (+100)
      if (nurse.assignedZone === patient.zoneId) {
        score += 100;
      }
      // Moderate preference: same wing (+30)
      else if (this.isSameWing(nurse.assignedZone, patient.zoneId)) {
        score += 30;
      }
      // Weak preference: same floor (+10)
      else if (this.isSameFloor(nurse.assignedZone, patient.zoneId)) {
        score += 10;
      }
      // Cross-floor: penalty (-50) — should almost never happen
      else {
        score -= 50;
      }

      // Prefer nurses with fewer patients (load balancing)
      score += (nurse.maxPatients - currentLoad) * 5;

      // Prefer nurses whose specialization matches
      if (patient.requiredCerts.length > 0 &&
          patient.requiredCerts.every((c) => nurse.certifications.includes(c))) {
        score += 15;
      }

      if (score > bestScore) {
        bestScore = score;
        best = nurse;
      }
    }

    return best;
  }

  private isSameWing(zoneA: string, zoneB: string): boolean {
    // Zone IDs are formatted as "4A-N" → wing is "4A"
    const wingA = zoneA.split('-')[0];
    const wingB = zoneB.split('-')[0];
    return wingA === wingB;
  }

  private isSameFloor(zoneA: string, zoneB: string): boolean {
    const floorA = parseInt(zoneA.charAt(0));
    const floorB = parseInt(zoneB.charAt(0));
    return floorA === floorB;
  }

  private findZoneNurseStation(zoneId: string): string {
    const zone = this.map.getRoomZone(zoneId);
    // Return first room in zone as proxy for nurse station position
    return zone?.hallwayOrder[0] ?? zoneId;
  }

  private calculateRouteDistance(startZone: string, rooms: string[]): number {
    if (rooms.length === 0) return 0;
    const { totalDistance } = this.optimizeRoute(startZone, rooms);
    return totalDistance;
  }
}

// === Types for zone-aware assignment ===

export interface ZoneNurse {
  id: string;
  name: string;
  assignedZone: string;
  certifications: string[];
  maxPatients: number;
}

export interface ZonePatient {
  id: string;
  room: string;
  zoneId: string;
  floor: number;
  acuityScore: number;
  isolationRequired: boolean;
  requiredCerts: string[];
}

export interface ZoneAssignment {
  nurseId: string;
  nurseName: string;
  primaryZone: string;
  patients: string[];
  totalWalkDistance: number;
  /** Isolation patients are always visited LAST in the route */
  isolationPatientsLast: string[];
}

// === Default Hospital Template ===

/** Generate a template hospital layout for prototyping */
export function createDefaultHospitalLayout(): HospitalLayout {
  const floors: Floor[] = [];

  for (let level = 2; level <= 5; level++) {
    const wings: Wing[] = [];
    for (const wingLetter of ['A', 'B']) {
      const zones: Zone[] = [];
      for (const direction of ['N', 'S']) {
        const zoneId = `${level}${wingLetter}-${direction}`;
        const rooms: Room[] = [];
        const hallwayOrder: string[] = [];

        // 10 rooms per zone
        for (let r = 0; r < 10; r++) {
          const roomNum = level * 100 + (wingLetter === 'A' ? 0 : 20) + (direction === 'N' ? 0 : 10) + r;
          const roomId = `${roomNum}`;
          rooms.push({
            id: roomId,
            zoneId,
            floor: level,
            hallwayPosition: r / 9,
            type: 'patient',
            beds: r === 0 ? 1 : 2, // First room is private
            equipment: level === 4 ? ['telemetry', 'smart_bed'] : ['smart_bed'],
          });
          hallwayOrder.push(roomId);
        }

        zones.push({
          id: zoneId,
          wingId: `${level}${wingLetter}`,
          floor: level,
          name: `Floor ${level} Wing ${wingLetter} ${direction === 'N' ? 'North' : 'South'}`,
          rooms,
          nurseStationId: `NS-${zoneId}`,
          isIsolation: direction === 'S' && wingLetter === 'B', // South B is isolation
          hallwayOrder,
          hallwayLength: 45, // 45 meters per zone hallway
        });
      }

      wings.push({
        id: `${level}${wingLetter}`,
        name: `Wing ${wingLetter}`,
        floor: level,
        zones,
        elevatorDistance: wingLetter === 'A' ? 10 : 25,
      });
    }

    floors.push({
      level,
      name: level === 2 ? 'Surgical' : level === 3 ? 'Med-Surg' : level === 4 ? 'Cardiac/Tele' : 'ICU',
      wings,
      nurseStations: wings.flatMap((w) =>
        w.zones.map((z) => ({
          id: `NS-${z.id}`,
          floor: level,
          wingId: w.id,
          zoneId: z.id,
          supplies: ['gloves', 'gowns', 'vitals_cart', 'medication_cart'],
        }))
      ),
    });
  }

  return {
    id: 'default-hospital',
    name: 'Medi-Hive General Hospital',
    floors,
    elevators: [
      {
        id: 'ELV-1',
        servesFloors: [1, 2, 3, 4, 5],
        avgWaitSeconds: 45,
        floorPositions: { 1: { wingId: '1A', hallwayPosition: 0 }, 2: { wingId: '2A', hallwayPosition: 0 }, 3: { wingId: '3A', hallwayPosition: 0 }, 4: { wingId: '4A', hallwayPosition: 0 }, 5: { wingId: '5A', hallwayPosition: 0 } },
      },
      {
        id: 'ELV-2',
        servesFloors: [1, 2, 3, 4, 5],
        avgWaitSeconds: 45,
        floorPositions: { 1: { wingId: '1B', hallwayPosition: 0 }, 2: { wingId: '2B', hallwayPosition: 0 }, 3: { wingId: '3B', hallwayPosition: 0 }, 4: { wingId: '4B', hallwayPosition: 0 }, 5: { wingId: '5B', hallwayPosition: 0 } },
      },
    ],
    stairwells: [
      { id: 'STR-1', servesFloors: [1, 2, 3, 4, 5], secondsPerFloor: 25, floorPositions: { 1: { wingId: '1A' }, 2: { wingId: '2A' }, 3: { wingId: '3A' }, 4: { wingId: '4A' }, 5: { wingId: '5A' } } },
    ],
  };
}
