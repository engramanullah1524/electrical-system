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
  /**
   * Link to an entry in the project's demand factor table. When set, the table's current value is
   * used, so a factor agreed later with the consultant updates every way that uses it.
   */
  ref?: string;
}

/** One row of a project's editable demand factor table, with the history of every change. */
export interface DemandFactorEntry {
  id: string;
  label: string;
  value: number;
  basis: Basis;
  history: { value: number; basis: Basis; changedOn: string; reason: string }[];
}

/** Load groups for DEWA transformer demand, each with its own diversity factor in the library. */
export type LoadCategory = 'chiller' | 'fahuPumpsLifts' | 'retail' | 'other';
export const LOAD_CATEGORIES: LoadCategory[] = ['chiller', 'fahuPumpsLifts', 'retail', 'other'];
export const LOAD_CATEGORY_LABEL: Record<LoadCategory, string> = {
  chiller: 'Chillers',
  fahuPumpsLifts: 'FAHUs, pumps and lifts',
  retail: 'Retail',
  other: 'Other loads',
};

/** Cable families with their own voltage-drop table in the library. */
export type CableKind = 'pvcSheathed' | 'singleCoreConduit';

/** The cable that feeds a board from the board above it. */
export interface CableRun {
  kind: CableKind;
  sizeMm2: number;
  /** Parallel cables per phase. */
  runs: number;
  lengthM: number;
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
  /** Circuit length to its furthest point, for voltage drop. */
  lengthM: number | null;
  cableKind: CableKind | null;
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
  category: LoadCategory | null;
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
  /** Incoming cable from the board above, for voltage drop. Not used on boards fed directly by DEWA. */
  feeder: CableRun | null;
  /** Load group of this board's own final circuits, for transformer demand. */
  loadCategory: LoadCategory | null;
  /** Diversity applied to this board's own final circuits. */
  circuitDemandFactor: Factor | null;
  /** Further diversity applied to the demand of boards fed from this one; empty means none. */
  childFactor: Factor | null;
  /**
   * Factor for all spare capacity aggregated at this board (e.g. 0.8 at the main distribution
   * board), replacing the spare ways' own panel-level factor. Empty means spares keep their own.
   */
  spareFactor: Factor | null;
  circuits: Circuit[];
  loads: DirectLoad[];
  meters: { singlePhase: number; threePhase: number; ct: number };
  location: string;
  remarks: string;
  /** Set when the board came from an imported workbook, so a re-import replaces it. */
  source?: { file: string; sheet: string; importedOn: string };
}
