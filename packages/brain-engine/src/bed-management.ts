import { HospitalLayout, Floor, Zone, Room } from './hospital-map';

/**
 * BedManager — Hospital-wide bed inventory and assignment engine.
 *
 * Tracks bed state across every floor/wing/zone and handles:
 * - Admission bed assignment (diagnosis → department, acuity → proximity, isolation → zone)
 * - Automatic status transitions (occupied → cleaning → available)
 * - Equipment tracking per bed
 * - Census and utilization reporting
 * - Capacity alerts (>85% on a floor)
 * - Discharge predictions and transfer coordination
 */

// === Types ===

export interface BedState {
  bedId: string;
  roomId: string;
  zoneId: string;
  floor: number;
  wing: string;
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved';
  patientId?: string;
  equipment: string[];
  isolation: boolean;
  lastStatusChange: string;
  estimatedAvailableAt?: string; // for cleaning/maintenance
}

export interface BedAssignmentRequest {
  patientId: string;
  department: string; // maps to floor
  acuityScore: number;
  isolationRequired: boolean;
  gender: 'male' | 'female' | 'other';
  requiredEquipment: string[];
  preferredFloor?: number;
}

export interface FloorCensus {
  floor: number;
  totalBeds: number;
  occupied: number;
  available: number;
  cleaning: number;
  maintenance: number;
  reserved: number;
  utilizationPct: number;
}

export interface BedAssignmentResult {
  success: boolean;
  bedId?: string;
  roomId?: string;
  floor?: number;
  wing?: string;
  reason?: string;
}

export interface TransferRecommendation {
  fromBedId: string;
  toBedId: string;
  toRoomId: string;
  toFloor: number;
  toWing: string;
  reason: string;
  score: number; // higher = better match
}

export interface BedManagerConfig {
  cleaningTimeMinutes: number; // default 45
  capacityAlertThresholdPct: number; // default 85
  departmentFloorMap: Record<string, number>; // "cardiac" → 4
}

// === Defaults ===

const DEFAULT_CONFIG: BedManagerConfig = {
  cleaningTimeMinutes: 45,
  capacityAlertThresholdPct: 85,
  departmentFloorMap: {
    surgical: 2,
    'med-surg': 3,
    medsurg: 3,
    cardiac: 4,
    telemetry: 4,
    icu: 5,
    'intensive care': 5,
  },
};

// === Manager ===

export class BedManager {
  private beds: Map<string, BedState> = new Map();
  private layout: HospitalLayout;
  private config: BedManagerConfig;

  // Gender tracking per room for room-matching rules
  private roomGender: Map<string, 'male' | 'female' | 'mixed' | 'empty'> = new Map();

  constructor(layout: HospitalLayout, config?: Partial<BedManagerConfig>) {
    this.layout = layout;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeBedsFromLayout();
  }

  // === Initialization ===

  /** Build the bed inventory from the hospital layout */
  private initializeBedsFromLayout(): void {
    for (const floor of this.layout.floors) {
      for (const wing of floor.wings) {
        for (const zone of wing.zones) {
          for (const room of zone.rooms) {
            if (room.type !== 'patient') continue;

            for (let b = 0; b < room.beds; b++) {
              const bedId = `${room.id}-B${b + 1}`;
              this.beds.set(bedId, {
                bedId,
                roomId: room.id,
                zoneId: zone.id,
                floor: floor.level,
                wing: wing.id,
                status: 'available',
                equipment: [...room.equipment],
                isolation: zone.isIsolation,
                lastStatusChange: new Date().toISOString(),
              });
            }

            this.roomGender.set(room.id, 'empty');
          }
        }
      }
    }
  }

  // === Bed Assignment ===

  /**
   * Assign the best available bed for an admission.
   *
   * Scoring criteria (in priority order):
   * 1. Department → correct floor
   * 2. Isolation requirement → isolation zone
   * 3. Gender → room matching (no mixing male/female in shared rooms)
   * 4. Acuity → proximity to nurse station (higher acuity = closer)
   * 5. Equipment → required equipment present
   * 6. Preferred floor (if specified)
   */
  assignBed(request: BedAssignmentRequest): BedAssignmentResult {
    const candidates = this.findCandidateBeds(request);

    if (candidates.length === 0) {
      return {
        success: false,
        reason: 'No suitable beds available matching admission criteria',
      };
    }

    // Score each candidate
    const scored = candidates.map((bed) => ({
      bed,
      score: this.scoreBedForRequest(bed, request),
    }));

    // Sort descending by score, pick best
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].bed;

    // Assign
    best.status = 'occupied';
    best.patientId = request.patientId;
    best.lastStatusChange = new Date().toISOString();
    best.estimatedAvailableAt = undefined;

    // Update room gender
    this.updateRoomGender(best.roomId, request.gender);

    return {
      success: true,
      bedId: best.bedId,
      roomId: best.roomId,
      floor: best.floor,
      wing: best.wing,
    };
  }

  // === Discharge ===

  /** Discharge a patient — transitions bed to cleaning */
  dischargeBed(bedId: string): boolean {
    const bed = this.beds.get(bedId);
    if (!bed || bed.status !== 'occupied') return false;

    const now = new Date();
    bed.status = 'cleaning';
    bed.patientId = undefined;
    bed.lastStatusChange = now.toISOString();

    const availableAt = new Date(now.getTime() + this.config.cleaningTimeMinutes * 60_000);
    bed.estimatedAvailableAt = availableAt.toISOString();

    // Recalculate room gender
    this.recalculateRoomGender(bed.roomId);

    return true;
  }

  /** Mark a bed as under maintenance */
  setMaintenance(bedId: string, estimatedMinutes: number): boolean {
    const bed = this.beds.get(bedId);
    if (!bed || bed.status === 'occupied') return false;

    const now = new Date();
    bed.status = 'maintenance';
    bed.lastStatusChange = now.toISOString();
    bed.estimatedAvailableAt = new Date(
      now.getTime() + estimatedMinutes * 60_000
    ).toISOString();

    return true;
  }

  /** Reserve a bed (e.g., incoming ER admission) */
  reserveBed(bedId: string, patientId: string): boolean {
    const bed = this.beds.get(bedId);
    if (!bed || bed.status !== 'available') return false;

    bed.status = 'reserved';
    bed.patientId = patientId;
    bed.lastStatusChange = new Date().toISOString();
    return true;
  }

  // === Cleaning Transitions ===

  /**
   * Process automatic cleaning → available transitions.
   * Called by the scheduler each tick. Returns the number of beds transitioned.
   */
  processCleaningTransitions(): number {
    const now = Date.now();
    let transitioned = 0;

    for (const bed of this.beds.values()) {
      if (bed.status !== 'cleaning' && bed.status !== 'maintenance') continue;
      if (!bed.estimatedAvailableAt) continue;

      const availableAt = new Date(bed.estimatedAvailableAt).getTime();
      if (now >= availableAt) {
        bed.status = 'available';
        bed.lastStatusChange = new Date().toISOString();
        bed.estimatedAvailableAt = undefined;
        transitioned++;
      }
    }

    return transitioned;
  }

  // === Census & Reporting ===

  /** Get census for a specific floor */
  getFloorCensus(floor: number): FloorCensus {
    const floorBeds = Array.from(this.beds.values()).filter((b) => b.floor === floor);
    const total = floorBeds.length;
    const occupied = floorBeds.filter((b) => b.status === 'occupied').length;
    const available = floorBeds.filter((b) => b.status === 'available').length;
    const cleaning = floorBeds.filter((b) => b.status === 'cleaning').length;
    const maintenance = floorBeds.filter((b) => b.status === 'maintenance').length;
    const reserved = floorBeds.filter((b) => b.status === 'reserved').length;

    return {
      floor,
      totalBeds: total,
      occupied,
      available,
      cleaning,
      maintenance,
      reserved,
      utilizationPct: total > 0 ? Math.round((occupied / total) * 100) : 0,
    };
  }

  /** Get census for every floor */
  getHospitalCensus(): FloorCensus[] {
    const floors = new Set<number>();
    for (const bed of this.beds.values()) {
      floors.add(bed.floor);
    }
    return Array.from(floors)
      .sort((a, b) => a - b)
      .map((f) => this.getFloorCensus(f));
  }

  /** Get census for a specific zone */
  getZoneCensus(zoneId: string): {
    zoneId: string;
    totalBeds: number;
    occupied: number;
    available: number;
  } {
    const zoneBeds = Array.from(this.beds.values()).filter((b) => b.zoneId === zoneId);
    return {
      zoneId,
      totalBeds: zoneBeds.length,
      occupied: zoneBeds.filter((b) => b.status === 'occupied').length,
      available: zoneBeds.filter((b) => b.status === 'available').length,
    };
  }

  /** Check if any floor exceeds the capacity alert threshold */
  getCapacityAlerts(): Array<{ floor: number; utilizationPct: number }> {
    const alerts: Array<{ floor: number; utilizationPct: number }> = [];
    const census = this.getHospitalCensus();

    for (const floor of census) {
      if (floor.utilizationPct >= this.config.capacityAlertThresholdPct) {
        alerts.push({
          floor: floor.floor,
          utilizationPct: floor.utilizationPct,
        });
      }
    }

    return alerts;
  }

  // === Equipment Tracking ===

  /** Add equipment to a bed */
  addEquipment(bedId: string, equipment: string): boolean {
    const bed = this.beds.get(bedId);
    if (!bed) return false;
    if (!bed.equipment.includes(equipment)) {
      bed.equipment.push(equipment);
    }
    return true;
  }

  /** Remove equipment from a bed */
  removeEquipment(bedId: string, equipment: string): boolean {
    const bed = this.beds.get(bedId);
    if (!bed) return false;
    bed.equipment = bed.equipment.filter((e) => e !== equipment);
    return true;
  }

  /** Find beds with specific equipment */
  findBedsWithEquipment(equipment: string[]): BedState[] {
    return Array.from(this.beds.values()).filter((bed) =>
      equipment.every((e) => bed.equipment.includes(e))
    );
  }

  // === Transfer Coordination ===

  /**
   * Find the best bed for an inter-floor transfer.
   * Used when a patient's condition changes and they need a different unit.
   */
  findTransferBed(
    currentBedId: string,
    targetDepartment: string,
    isolationRequired: boolean,
    requiredEquipment: string[]
  ): TransferRecommendation | null {
    const currentBed = this.beds.get(currentBedId);
    if (!currentBed) return null;

    const targetFloor = this.config.departmentFloorMap[targetDepartment.toLowerCase()];

    const candidates = Array.from(this.beds.values()).filter((bed) => {
      if (bed.status !== 'available') return false;
      if (bed.bedId === currentBedId) return false;
      if (isolationRequired && !bed.isolation) return false;
      if (targetFloor !== undefined && bed.floor !== targetFloor) return false;
      if (!requiredEquipment.every((e) => bed.equipment.includes(e))) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    // Score by proximity and equipment match
    const scored = candidates.map((bed) => {
      let score = 50; // base

      // Same floor bonus
      if (bed.floor === currentBed.floor) score += 20;

      // Equipment match bonus (extra equipment is a plus)
      score += bed.equipment.length * 2;

      // Isolation match
      if (isolationRequired && bed.isolation) score += 15;

      return { bed, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    return {
      fromBedId: currentBedId,
      toBedId: best.bed.bedId,
      toRoomId: best.bed.roomId,
      toFloor: best.bed.floor,
      toWing: best.bed.wing,
      reason: `Transfer to ${targetDepartment} (floor ${best.bed.floor})`,
      score: best.score,
    };
  }

  // === Predicted Availability ===

  /**
   * Estimate when beds will become available, combining:
   * - Currently cleaning beds (known ETA)
   * - Reserved beds that may free up
   */
  predictAvailability(floor?: number): Array<{
    bedId: string;
    roomId: string;
    estimatedAvailableAt: string;
    currentStatus: string;
  }> {
    const predictions: Array<{
      bedId: string;
      roomId: string;
      estimatedAvailableAt: string;
      currentStatus: string;
    }> = [];

    for (const bed of this.beds.values()) {
      if (floor !== undefined && bed.floor !== floor) continue;
      if (!bed.estimatedAvailableAt) continue;
      if (bed.status !== 'cleaning' && bed.status !== 'maintenance') continue;

      predictions.push({
        bedId: bed.bedId,
        roomId: bed.roomId,
        estimatedAvailableAt: bed.estimatedAvailableAt,
        currentStatus: bed.status,
      });
    }

    // Sort by soonest available
    predictions.sort(
      (a, b) =>
        new Date(a.estimatedAvailableAt).getTime() -
        new Date(b.estimatedAvailableAt).getTime()
    );

    return predictions;
  }

  // === Direct Access ===

  /** Get a specific bed's state */
  getBed(bedId: string): BedState | undefined {
    return this.beds.get(bedId);
  }

  /** Get all beds in a room */
  getRoomBeds(roomId: string): BedState[] {
    return Array.from(this.beds.values()).filter((b) => b.roomId === roomId);
  }

  /** Get total bed count */
  getTotalBeds(): number {
    return this.beds.size;
  }

  // === Private Helpers ===

  /** Find candidate beds matching hard constraints */
  private findCandidateBeds(request: BedAssignmentRequest): BedState[] {
    const targetFloor =
      request.preferredFloor ??
      this.config.departmentFloorMap[request.department.toLowerCase()];

    return Array.from(this.beds.values()).filter((bed) => {
      // Must be available
      if (bed.status !== 'available') return false;

      // Isolation requirement
      if (request.isolationRequired && !bed.isolation) return false;
      if (!request.isolationRequired && bed.isolation) return false; // don't waste isolation beds

      // Equipment
      if (!request.requiredEquipment.every((e) => bed.equipment.includes(e))) return false;

      // Gender matching in shared rooms
      if (!this.isGenderCompatible(bed.roomId, request.gender)) return false;

      // Floor matching (soft — handled in scoring if not strict)
      if (targetFloor !== undefined && bed.floor !== targetFloor) return false;

      return true;
    });
  }

  /** Score a candidate bed for an assignment request */
  private scoreBedForRequest(bed: BedState, request: BedAssignmentRequest): number {
    let score = 50; // base score

    // Department/floor match
    const targetFloor =
      request.preferredFloor ??
      this.config.departmentFloorMap[request.department.toLowerCase()];
    if (targetFloor !== undefined && bed.floor === targetFloor) {
      score += 30;
    }

    // Higher acuity patients should be closer to nurse stations
    // Zones with nurse stations get a boost proportional to acuity
    if (request.acuityScore >= 7) {
      // Check if this zone has a nurse station (infer from zone layout)
      const zone = this.findZone(bed.zoneId);
      if (zone?.nurseStationId) {
        score += 20;
      }
    }

    // Isolation match (already filtered, but exact match gets a small bonus)
    if (request.isolationRequired && bed.isolation) {
      score += 10;
    }

    // Equipment bonus (extra equipment beyond required is a plus for high-acuity)
    const extraEquipment = bed.equipment.length - request.requiredEquipment.length;
    if (request.acuityScore >= 5) {
      score += Math.min(10, extraEquipment * 2);
    }

    // Private room bonus for isolation or high-acuity patients
    const roomBeds = this.getRoomBeds(bed.roomId);
    if (roomBeds.length === 1 && (request.isolationRequired || request.acuityScore >= 8)) {
      score += 15;
    }

    // Gender: prefer rooms already matching gender (avoid creating mixed-but-ok rooms)
    const roomGender = this.roomGender.get(bed.roomId);
    if (roomGender === 'empty') {
      score += 5; // fresh room is fine
    } else if (
      (roomGender === 'male' && request.gender === 'male') ||
      (roomGender === 'female' && request.gender === 'female')
    ) {
      score += 10; // same gender already present — good
    }

    return score;
  }

  /** Check if placing a patient of this gender in this room is allowed */
  private isGenderCompatible(
    roomId: string,
    gender: 'male' | 'female' | 'other'
  ): boolean {
    const roomBeds = this.getRoomBeds(roomId);

    // Single-bed rooms — always compatible
    if (roomBeds.length <= 1) return true;

    // Check current occupants
    const occupiedBeds = roomBeds.filter((b) => b.status === 'occupied' && b.patientId);
    if (occupiedBeds.length === 0) return true; // empty room

    // 'other' gender can go anywhere
    if (gender === 'other') return true;

    // Room gender must match
    const currentGender = this.roomGender.get(roomId);
    if (currentGender === 'empty' || currentGender === 'mixed') return true;
    return currentGender === gender;
  }

  /** Update the tracked gender of a room */
  private updateRoomGender(
    roomId: string,
    newGender: 'male' | 'female' | 'other'
  ): void {
    const current = this.roomGender.get(roomId) ?? 'empty';
    if (current === 'empty' && newGender !== 'other') {
      this.roomGender.set(roomId, newGender);
    } else if (current !== newGender && newGender !== 'other' && current !== 'mixed') {
      this.roomGender.set(roomId, 'mixed');
    }
  }

  /** Recalculate room gender after a discharge */
  private recalculateRoomGender(roomId: string): void {
    const roomBeds = this.getRoomBeds(roomId);
    const occupiedBeds = roomBeds.filter((b) => b.status === 'occupied');

    if (occupiedBeds.length === 0) {
      this.roomGender.set(roomId, 'empty');
      return;
    }

    // We don't store patient gender on the bed, so keep current value
    // In production, this would look up patient gender from the data source
  }

  /** Find a zone by ID from the layout */
  private findZone(zoneId: string): Zone | undefined {
    for (const floor of this.layout.floors) {
      for (const wing of floor.wings) {
        for (const zone of wing.zones) {
          if (zone.id === zoneId) return zone;
        }
      }
    }
    return undefined;
  }
}
