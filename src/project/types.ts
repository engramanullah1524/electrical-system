import type { DemandFactorEntry, Factor, PhaseKW, PointType } from '../design/types';

/** The body that issues the building permit, which decides the approval route. */
export type PermitAuthority = 'DM' | 'DDA' | 'Trakhees' | 'Other';

export const PERMIT_AUTHORITY_LABEL: Record<PermitAuthority, string> = {
  DM: 'Dubai Municipality',
  DDA: 'Dubai Development Authority',
  Trakhees: 'Trakhees (PCFC)',
  Other: 'Other',
};

export interface Project {
  id: string;
  name: string;
  permitAuthority: PermitAuthority;
  /** False until the authority has been read off the actual permit, not just stated. */
  authorityConfirmed: boolean;
  buildings: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Design settings; absent on projects created before the design screens. */
  designPowerFactor?: Factor | null;
  vdCurrentBasis?: 'demand' | 'connected' | null;
  nocKWByBuilding?: Record<string, number>;
  pointTypes?: PointType[];
  /** Editable demand factors: seeded from the library, changed later with a reason and date. */
  demandFactors?: DemandFactorEntry[];
  /** Residential unit (flat) DB types and the typical floors they repeat on. */
  unitTypes?: UnitType[];
  typicalFloors?: TypicalFloor[];
  /** Way label prefix for unit DBs, e.g. "DB-" gives "DB-101 (STD)". */
  unitDbPrefix?: string;
  /** Use the DEWA-approved 70 mm² ECC with 150 mm² cables instead of the Building Code's 95 mm². */
  eccPrecedent150?: boolean;
  /** Fault duty written on the schedule, entered by the designer (kA). */
  faultKA?: FaultDuty;
  /** Title block of the exported load schedule. */
  details?: ProjectDetails;
  /** Gland and lug sizes by conductor size, seeded from the user's schedule; blanks are filled by the user. */
  glandTable?: GlandRow[];
}

/** A residential unit (flat) DB type repeated over typical floors. */
export interface UnitType {
  id: string;
  /** Short name used in way labels, e.g. "STD" or "1BHK-A". */
  name: string;
  /** Connected load per phase in kW, from the flat DB schedule. */
  phaseKW: PhaseKW;
  phases: 1 | 3;
  /** Needs its own DEWA (tenant) meter. */
  metered: boolean;
  /** Demand factor table entry used for this unit's DB. */
  factorRef: string;
}

/** One floor of the plan: its SMDB, the LV panel feeding it, and how many units of each type it has. */
export interface TypicalFloor {
  id: string;
  building: string;
  floor: string;
  smdb: string;
  panel: string;
  /** Number of the floor's first unit (e.g. 101); the others follow on. */
  firstUnitNo: number;
  counts: Record<string, number>;
}

export interface FaultDuty {
  lvPanel: number | null;
  lvWays: number | null;
  smdbWays: number | null;
}

export interface ProjectDetails {
  owner: string;
  consultant: string;
  area: string;
  plotNo: string;
  completionDate: string;
  preparedBy: string;
  telephone: string;
  fax: string;
  revision: string;
  date: string;
}

/** Sizes for one conductor size: the 4-core cable's gland and lugs, and the parts when this size is an ECC. */
export interface GlandRow {
  sizeMm2: number;
  gland: string;
  lug: string;
  eccGland: string;
  eccLug: string;
  /** Where the values came from, e.g. the user's schedule or "entered on 2026-09-20". */
  source: string;
}
