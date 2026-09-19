import type { Clause } from '../library/types';
import type { DemandFactorEntry, Factor } from '../design/types';
import { today } from '../db/db';

/** Library clauses whose parameters seed a project's demand factor table, with readable names. */
const SEED_CLAUSES = ['designer-demand-factors/by-load-type', 'designer-demand-factors/flat-db', 'doe-ewr-2020/G2-landlord'];

const LABELS: Record<string, string> = {
  dfResidentialSmdb: 'Residential SMDB',
  dfFlatDb: 'Residential unit (flat) DB',
  dfPumps: 'Pumps (incl. chilled-water)',
  dfAhuOahu: 'AHU / OAHU',
  dfPassengerLift: 'Passenger lift',
  dfServiceFiremanLift: 'Service / fireman lift',
  dfDbSubstation: 'Substation DB',
  dfEvCharger: 'EV charger SMDB',
  dfEmdb: 'EMDB',
  dfExtractMakeupFans: 'Extract / make-up fans',
  dfIrrigationPumps: 'Irrigation pumps',
  dfSwimmingPool: 'Swimming pool',
  spareAtPanel: 'Spare, at its own panel',
  spareAtMainBoard: 'Spare, when aggregated at the main board',
  dfLandlordServices: 'Common-area / landlord SMDB',
  dfExternalLighting: 'External lighting',
};

/** Builds the starting table from the library; existing entries are never overwritten. */
export function seedFactors(clauses: Clause[], existing: DemandFactorEntry[] = []): DemandFactorEntry[] {
  const have = new Set(existing.map((e) => e.id));
  const added: DemandFactorEntry[] = [];
  for (const clauseId of SEED_CLAUSES) {
    const clause = clauses.find((c) => c.id === clauseId);
    for (const param of clause?.params ?? []) {
      if (typeof param.value !== 'number' || have.has(param.key)) continue;
      added.push({
        id: param.key,
        label: LABELS[param.key] ?? param.key,
        value: param.value,
        basis: { kind: 'clause', clauseId, key: param.key },
        history: [],
      });
      have.add(param.key);
    }
  }
  return [...existing, ...added];
}

/** Records a new value, keeping the old one, its basis, the date and the reason in the history. */
export function changeFactor(entry: DemandFactorEntry, value: number, reason: string): DemandFactorEntry {
  return {
    ...entry,
    value,
    basis: { kind: 'declared', reason },
    history: [...entry.history, { value: entry.value, basis: entry.basis, changedOn: today(), reason }],
  };
}

/** A factor that follows the table entry, so later changes flow to every way that uses it. */
export const linkedFactor = (entry: DemandFactorEntry): Factor => ({ value: entry.value, basis: entry.basis, ref: entry.id });

export const basisText = (factor: { basis: Factor['basis'] }) =>
  factor.basis.kind === 'clause' ? `from ${factor.basis.clauseId}` : `declared: ${factor.basis.reason}`;
