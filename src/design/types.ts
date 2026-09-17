/** Load schedule model, following the DEWA schedule formats in Dubai Building Code Tables G.11–G.14. */

export type Phase = 'R' | 'Y' | 'B';
export const PHASES: Phase[] = ['R', 'Y', 'B'];
export type PhaseKW = Record<Phase, number>;

/**
 * Where a designer's number comes from: a library clause, or the designer's own declaration with a
 * reason (for example fixture wattage from a datasheet, or a demand factor they justify to DEWA).
 */
export type Basis = { kind: 'clause'; clauseId: string; key: string } | { kind: 'declared'; reason: string };

export interface Factor {
  value: number;
  basis: Basis;
}

export type PointCategory =
  | 'lighting'
  | 'fan'
  | 'socket13A'
  | 'socket15A'
  | 'ac'
  | 'waterHeater'
  | 'appliance'
  | 'other';

/** A kind of point on a final circuit (a downlight, a twin socket, a water heater…) and its load. */
export interface PointType {
  id: string;
  label: string;
  category: PointCategory;
  watts: number;
  /** A twin socket outlet counts as two socket outlets. */
  socketsPerPoint: number;
  basis: Basis;
}

export interface Circuit {
  id: string;
  no: string;
  /** 'RYB' is a three-phase circuit, shared equally. */
  phase: Phase | 'RYB';
  breakerA: number | null;
  rcdMA: number | null;
  wireMm2: number | null;
  eccMm2: number | null;
  area: string;
  points: Record<string, number>;
  /** Stationary appliances counted at their actual load, in watts. */
  equipmentW: number;
  standby: boolean;
  remarks: string;
}

/** A load fed directly from a panel: a pump, a lift, a spare way, future provision. */
export interface DirectLoad {
  id: string;
  label: string;
  kind: 'equipment' | 'spare' | 'future';
  phaseKW: PhaseKW;
  demandFactor: Factor;
  /** The part of this load that only runs on standby (e.g. a fire pump), left out of maximum demand. */
  standbyKW: number;
  /** Largest single motor or compressor, for the DEWA approval rule on loads above 100 kW. */
  largestMotorKW: number | null;
  remarks: string;
}

export type BoardKind = 'LVP' | 'MDB' | 'SMDB' | 'EMDB' | 'ATS' | 'MCC' | 'DB';

export type Supply = { kind: 'transformer'; kVA: number } | { kind: 'feeder'; amps: number };

export interface Board {
  id: string;
  projectId: string;
  building: string;
  ref: string;
  kind: BoardKind;
  parentId: string | null;
  /** Set on a board fed directly from DEWA. */
  supply: Supply | null;
  phases: 1 | 3;
  incomerDevice: string;
  incomerA: number | null;
  faultKA: number | null;
  cable: string;
  eccMm2: number | null;
  lengthM: number | null;
  /** Diversity applied to this board's own final circuits. */
  circuitDemandFactor: Factor | null;
  /** Further diversity applied to the demand of boards fed from this one; empty means none. */
  childFactor: Factor | null;
  circuits: Circuit[];
  loads: DirectLoad[];
  meters: { singlePhase: number; threePhase: number; ct: number };
  location: string;
  remarks: string;
}
