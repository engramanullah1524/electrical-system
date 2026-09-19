import { usableClause, type LibraryLookup } from '../library/provenance';
import type { Clause } from '../library/types';
import { totalKW, type BoardResult } from './engine';
import type { Board, DirectLoad } from './types';

/**
 * Automatic incomer, cable, ECC, meter and transformer selection, following the rules the user chose
 * on 2026-09-19. Every number comes from a library clause the user has verified; if one is not
 * verified yet, the part that needs it is reported as blocked instead of being guessed.
 */
export const SIZING_CLAUSES = {
  breaker: 'designer-sizing-rules/breaker-cable',
  cables: 'dewa-reference-chart-b/cable-selection-4c',
  ecc: 'dm-dbc-2021/G.4.19.3',
  eccPrecedent: 'designer-sizing-rules/ecc-dewa-precedent',
  meters: 'dewa-reference-chart-b/metering',
  transformer: 'dewa-transformer-md-note/limits',
  lvPanel: 'designer-sizing-rules/lv-panel-transformer',
} as const;
const VOLTAGE_CLAUSES = ['dm-dbc-2021/G.4.2', 'dewa-rei-2017/1.2'];

export interface CableRow {
  key: string;
  runs: number;
  sizeMm2: number;
  maxKW: number;
  /** Breaker capacity; the upper value where the chart prints a range. */
  cbA: number;
  cbMinA: number | null;
}
export interface BreakerRule {
  margin: number;
  ampsPerKW: number;
  ratingsA: number[];
  conductorSizesMm2: number[];
}
export interface EccRule {
  sameUpTo: number;
  midSize: number;
  midBelow: number;
  halfAbove: number;
}
export interface MeterRule {
  direct1MaxKW: number;
  direct3MaxKW: number;
  directMaxCableMm2: number;
  checkAboveKW: number;
  ct: { ratio: number; maxKW: number }[];
  ct2000AboveKW: number;
}
export interface TxLimit {
  kVA: number;
  maxKW: number;
}

export interface SizingRules {
  breaker: BreakerRule | null;
  cables: CableRow[] | null;
  ecc: EccRule | null;
  /** The DEWA-approved 70 mm² ECC for 150 mm² cables, used only when the project opts in. */
  eccPrecedent150: number | null;
  eccPrecedentReason: string;
  meters: MeterRule | null;
  transformer: TxLimit[] | null;
  lvPanel: boolean;
  voltageLL: number | null;
  /** Why a part cannot run yet, e.g. its clause is not verified. */
  blocked: string[];
  clauseIds: string[];
}

const num = (clause: Clause, key: string) => {
  const value = clause.params.find((p) => p.key === key)?.value;
  return typeof value === 'number' ? value : undefined;
};
const list = (clause: Clause, key: string) => {
  const value = clause.params.find((p) => p.key === key)?.value;
  return typeof value === 'string' ? value.split(',').map(Number).filter(Number.isFinite) : [];
};

export function loadSizingRules(library: LibraryLookup): SizingRules {
  const blocked: string[] = [];
  const clauseIds: string[] = [];
  const use = (id: string): Clause | null => {
    const checked = usableClause(library, id);
    if (!checked.usable) {
      blocked.push(checked.reason);
      return null;
    }
    clauseIds.push(id);
    return checked.clause;
  };
  const missing = (clause: Clause, what: string) => {
    blocked.push(`${clause.ref} does not state ${what}.`);
    return null;
  };

  const b = use(SIZING_CLAUSES.breaker);
  let breaker: BreakerRule | null = null;
  if (b) {
    const margin = num(b, 'breakerMarginFactor');
    const ampsPerKW = num(b, 'ampsPerKW');
    const ratingsA = list(b, 'breakerRatingsA').sort((x, y) => x - y);
    const conductorSizesMm2 = list(b, 'conductorSizesMm2').sort((x, y) => x - y);
    breaker = margin && ampsPerKW && ratingsA.length && conductorSizesMm2.length ? { margin, ampsPerKW, ratingsA, conductorSizesMm2 } : missing(b, 'the breaker rule in full');
  }

  const c = use(SIZING_CLAUSES.cables);
  let cables: CableRow[] | null = null;
  if (c) {
    const rows: CableRow[] = [];
    for (const p of c.params) {
      const m = /^maxKW_(?:(\d+)x)?(\d+)$/.exec(p.key);
      if (!m || typeof p.value !== 'number') continue;
      const key = p.key.slice('maxKW_'.length);
      const cbA = num(c, `cbA_${key}`);
      if (cbA === undefined) continue;
      rows.push({ key, runs: m[1] ? Number(m[1]) : 1, sizeMm2: Number(m[2]), maxKW: p.value, cbA, cbMinA: num(c, `cbMinA_${key}`) ?? null });
    }
    cables = rows.length ? rows.sort((x, y) => x.cbA - y.cbA || x.maxKW - y.maxKW) : missing(c, 'any cable rows');
  }

  const e = use(SIZING_CLAUSES.ecc);
  let ecc: EccRule | null = null;
  if (e) {
    const sameUpTo = num(e, 'eccSameAsPhaseUpToMm2');
    const midSize = num(e, 'eccMidSizeMm2');
    const midBelow = num(e, 'eccMidBelowMm2');
    const halfAbove = num(e, 'eccHalfAboveMm2');
    ecc = sameUpTo && midSize && midBelow && halfAbove ? { sameUpTo, midSize, midBelow, halfAbove } : missing(e, 'the ECC table in full');
  }

  const precedent = usableClause(library, SIZING_CLAUSES.eccPrecedent);
  const eccPrecedent150 = precedent.usable ? (num(precedent.clause, 'eccFor150Mm2') ?? null) : null;

  const m = use(SIZING_CLAUSES.meters);
  let meters: MeterRule | null = null;
  if (m) {
    const ct: { ratio: number; maxKW: number }[] = [];
    for (const p of m.params) {
      const match = /^ctMaxKW_(\d+)$/.exec(p.key);
      if (match && typeof p.value === 'number') ct.push({ ratio: Number(match[1]), maxKW: p.value });
    }
    const direct1MaxKW = num(m, 'meterDirect1PhMaxKW');
    const direct3MaxKW = num(m, 'meterDirect3PhMaxKW');
    const directMaxCableMm2 = num(m, 'meterDirectMaxCable');
    const checkAboveKW = num(m, 'checkMeterAboveKW');
    const ct2000AboveKW = num(m, 'ct2000AboveKW');
    meters =
      direct1MaxKW && direct3MaxKW && directMaxCableMm2 && checkAboveKW && ct2000AboveKW && ct.length
        ? { direct1MaxKW, direct3MaxKW, directMaxCableMm2, checkAboveKW, ct: ct.sort((x, y) => x.maxKW - y.maxKW), ct2000AboveKW }
        : missing(m, 'the meter table in full');
  }

  const t = use(SIZING_CLAUSES.transformer);
  let transformer: TxLimit[] | null = null;
  if (t) {
    const limits: TxLimit[] = [];
    for (const p of t.params) {
      const match = /^txMdLimit(\d+)kVA$/.exec(p.key);
      if (match && typeof p.value === 'number') limits.push({ kVA: Number(match[1]), maxKW: p.value });
    }
    transformer = limits.length ? limits.sort((x, y) => x.kVA - y.kVA) : missing(t, 'any transformer limits');
  }

  const lvPanel = use(SIZING_CLAUSES.lvPanel) !== null;

  let voltageLL: number | null = null;
  const voltageReasons: string[] = [];
  for (const id of VOLTAGE_CLAUSES) {
    const checked = usableClause(library, id);
    if (!checked.usable) {
      voltageReasons.push(checked.reason);
      continue;
    }
    const v = num(checked.clause, 'nominalVoltageLL');
    if (v) {
      voltageLL = v;
      clauseIds.push(id);
      break;
    }
  }
  if (voltageLL === null) blocked.push(voltageReasons.join(' '));

  return {
    breaker,
    cables,
    ecc,
    eccPrecedent150,
    eccPrecedentReason: precedent.usable ? '' : precedent.reason,
    meters,
    transformer,
    lvPanel,
    voltageLL,
    blocked,
    clauseIds,
  };
}

/** Breaker = the next rating at or above connected load × margin × amps per kW. */
export function breakerFor(tclKW: number, rule: BreakerRule): { designA: number; breakerA: number | null } {
  const designA = tclKW * rule.margin * rule.ampsPerKW;
  return { designA, breakerA: rule.ratingsA.find((r) => r >= designA - 1e-9) ?? null };
}

/** The smallest chart row whose breaker capacity covers the breaker and whose maximum load covers the TCL. */
export function cableFor(breakerA: number, tclKW: number, rows: CableRow[]): CableRow | null {
  return rows.find((r) => r.cbA >= breakerA && r.maxKW >= tclKW - 1e-9) ?? null;
}

export type EccPick = { mm2: number; note?: string } | { mm2: null; reason: string };

/** Minimum ECC per run for a phase conductor of the given size (Building Code Table G.20). */
export function eccFor(sizeMm2: number, rule: EccRule, sizes: number[], precedent150: number | null): EccPick {
  if (sizeMm2 <= rule.sameUpTo) return { mm2: sizeMm2 };
  if (sizeMm2 < rule.midBelow) return { mm2: rule.midSize };
  if (sizeMm2 > rule.halfAbove) {
    if (sizeMm2 === 150 && precedent150 !== null) return { mm2: precedent150, note: 'DEWA-approved precedent chosen for this project' };
    const half = sizeMm2 / 2;
    const size = sizes.find((s) => s >= half - 1e-9);
    return size === undefined ? { mm2: null, reason: `no standard size at or above ${half} mm²` } : { mm2: size };
  }
  return { mm2: null, reason: `Table G.20 gives no ECC size for exactly ${sizeMm2} mm²; confirm it` };
}

export type MeterPick = { kind: '1PH' | '3PH' } | { kind: 'CT'; ratio: number; checkMeter: boolean } | { kind: null; reason: string };

/** A DEWA meter for a load of the given kW (direct meters first, then CT ratios). */
export function meterFor(kW: number, phases: 1 | 3, rule: MeterRule): MeterPick {
  if (phases === 1) {
    return kW <= rule.direct1MaxKW ? { kind: '1PH' } : { kind: null, reason: `a single-phase load above ${rule.direct1MaxKW} kW has no direct meter in the chart` };
  }
  if (kW <= rule.direct3MaxKW) return { kind: '3PH' };
  return ctMeterFor(kW, rule);
}

export function ctMeterFor(kW: number, rule: MeterRule): MeterPick {
  const checkMeter = kW > rule.checkAboveKW;
  const row = rule.ct.find((r) => kW <= r.maxKW + 1e-9);
  if (row) return { kind: 'CT', ratio: row.ratio, checkMeter };
  if (kW > rule.ct2000AboveKW) return { kind: 'CT', ratio: 2000, checkMeter };
  return { kind: null, reason: `no CT meter in the chart for ${kW} kW` };
}

/** The smallest transformer whose maximum-demand limit covers the demand. */
export const transformerFor = (mdKW: number, limits: TxLimit[]) => limits.find((l) => l.maxKW >= mdKW - 1e-9) ?? null;

/** LV panel main incomer from the transformer: the next rating at or above its full-load current. */
export function lvIncomerFor(kVA: number, ratingsA: number[], voltageLL: number) {
  const flcA = (kVA * 1000) / (Math.sqrt(3) * voltageLL);
  const acbA = ratingsA.find((r) => r >= flcA - 1e-9) ?? null;
  return { flcA, acbA, setting: acbA ? Math.round((flcA / acbA) * 100) / 100 : null };
}

export interface Sized {
  tclKW: number;
  designA: number | null;
  breakerA: number | null;
  cable: CableRow | null;
  /** ECC per run. */
  eccMm2: number | null;
  meter: MeterPick | null;
  notes: string[];
}

export interface LvSizing {
  transformer: TxLimit | null;
  flcA: number | null;
  acbA: number | null;
  setting: number | null;
  ctMeter: MeterPick | null;
  notes: string[];
}

export interface BoardSizing {
  boardId: string;
  /** The board's own incomer and feeder cable, when it is fed from another board. */
  incomer: Sized | null;
  /** Transformer, ACB and CT meter, for an LV panel fed by DEWA. */
  lv: LvSizing | null;
  /** Ways sized by the rule: unit (flat) DBs, keyed by load id. */
  ways: Map<string, Sized>;
  /** Meters on this board's ways and on every board below it. */
  meters: { singlePhase: number; threePhase: number; ct: number };
}

/** Ways the TCL rule sizes: residential unit DBs (the user's rule covers flat DBs and boards). */
export const sizedByRule = (load: DirectLoad) => Boolean(load.unitTypeId);

export function sizeOne(tclKW: number, phases: 1 | 3, metered: boolean, rules: SizingRules, eccPrecedent: boolean): Sized {
  const notes: string[] = [];
  const out: Sized = { tclKW, designA: null, breakerA: null, cable: null, eccMm2: null, meter: null, notes };
  if (!rules.breaker) {
    notes.push('breaker rule not verified yet');
    return out;
  }
  if (phases === 1) {
    notes.push('the TCL × 1.25 × 1.73 rule is for three-phase loads; a single-phase rule has not been set');
  } else {
    const { designA, breakerA } = breakerFor(tclKW, rules.breaker);
    out.designA = designA;
    out.breakerA = breakerA;
    if (breakerA === null) notes.push(`${designA.toFixed(0)} A is above the largest listed rating`);
    else if (!rules.cables) notes.push('chart B cable table not verified yet');
    else {
      out.cable = cableFor(breakerA, tclKW, rules.cables);
      if (!out.cable) notes.push(`no chart B cable row covers ${breakerA} A and ${tclKW.toFixed(2)} kW`);
    }
  }
  if (out.cable) {
    if (!rules.ecc) notes.push('ECC table (G.4.19.3) not verified yet');
    else {
      if (eccPrecedent && out.cable.sizeMm2 === 150 && rules.eccPrecedent150 === null) notes.push(`the 70 mm² precedent cannot be used: ${rules.eccPrecedentReason}`);
      const ecc = eccFor(out.cable.sizeMm2, rules.ecc, rules.breaker.conductorSizesMm2, eccPrecedent ? rules.eccPrecedent150 : null);
      if (ecc.mm2 === null) notes.push(ecc.reason);
      else {
        out.eccMm2 = ecc.mm2;
        if (ecc.note) notes.push(ecc.note);
      }
    }
  }
  if (metered) {
    if (!rules.meters) notes.push('meter table not verified yet');
    else {
      out.meter = meterFor(tclKW, phases, rules.meters);
      if (out.meter.kind === null) notes.push(out.meter.reason);
      else if (out.meter.kind !== 'CT' && out.cable && out.cable.sizeMm2 > rules.meters.directMaxCableMm2) {
        notes.push(`a direct meter takes cable up to ${rules.meters.directMaxCableMm2} mm²`);
      }
    }
  }
  return out;
}

/** Sizes every board and every unit way, bottom-up for meter counts. */
export function sizeBoards(
  boards: Board[],
  results: Map<string, BoardResult>,
  rules: SizingRules,
  options: { eccPrecedent: boolean },
): Map<string, BoardSizing> {
  const out = new Map<string, BoardSizing>();
  const byId = new Map(boards.map((b) => [b.id, b]));
  const children = new Map<string, Board[]>();
  for (const b of boards) if (b.parentId && byId.has(b.parentId)) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b]);

  const visit = (board: Board): BoardSizing => {
    const done = out.get(board.id);
    if (done) return done;
    const result = results.get(board.id);
    const tclKW = result?.connectedKW ?? 0;
    const meters = { singlePhase: 0, threePhase: 0, ct: 0 };
    const count = (pick: MeterPick | null) => {
      if (pick?.kind === '1PH') meters.singlePhase++;
      else if (pick?.kind === '3PH') meters.threePhase++;
      else if (pick?.kind === 'CT') meters.ct++;
    };

    const ways = new Map<string, Sized>();
    for (const load of board.loads) {
      if (!sizedByRule(load)) continue;
      const sized = sizeOne(totalKW(load.phaseKW), load.phases ?? 3, load.metered === true, rules, options.eccPrecedent);
      ways.set(load.id, sized);
      count(sized.meter);
    }
    for (const child of children.get(board.id) ?? []) {
      const c = visit(child);
      meters.singlePhase += c.meters.singlePhase;
      meters.threePhase += c.meters.threePhase;
      meters.ct += c.meters.ct;
    }

    const fedByDewa = !board.parentId || !byId.has(board.parentId);
    let incomer: Sized | null = null;
    let lv: LvSizing | null = null;
    if (!fedByDewa) incomer = sizeOne(tclKW, board.phases, false, rules, options.eccPrecedent);
    else if (board.kind === 'LVP' || board.supply?.kind === 'transformer') {
      lv = sizeLvPanel(result?.demandKW ?? 0, board.supply?.kind === 'transformer' ? board.supply.kVA : null, rules);
      count(lv.ctMeter);
    }
    const sizing: BoardSizing = { boardId: board.id, incomer, lv, ways, meters };
    out.set(board.id, sizing);
    return sizing;
  };
  for (const board of boards) visit(board);
  return out;
}

/** Transformer from the panel's maximum demand, then the ACB from its full-load current and the CT meter from demand. */
export function sizeLvPanel(mdKW: number, enteredKVA: number | null, rules: SizingRules): LvSizing {
  const notes: string[] = [];
  const lv: LvSizing = { transformer: null, flcA: null, acbA: null, setting: null, ctMeter: null, notes };
  if (!rules.lvPanel) {
    notes.push('LV panel rule not verified yet');
    return lv;
  }
  if (!rules.transformer) notes.push('transformer limits not verified yet');
  else {
    lv.transformer = transformerFor(mdKW, rules.transformer);
    if (!lv.transformer) notes.push(`maximum demand ${mdKW.toFixed(1)} kW is above the largest transformer limit; split the load`);
    if (enteredKVA !== null) {
      const entered = rules.transformer.find((l) => l.kVA === enteredKVA);
      if (!entered) notes.push(`the entered ${enteredKVA} kVA is not in the DEWA note`);
      else if (entered.maxKW < mdKW) notes.push(`the entered ${enteredKVA} kVA allows ${entered.maxKW} kW, below ${mdKW.toFixed(1)} kW`);
    }
  }
  const kVA = enteredKVA ?? lv.transformer?.kVA ?? null;
  if (kVA !== null) {
    if (!rules.breaker || rules.voltageLL === null) notes.push('breaker ratings or supply voltage not verified yet');
    else {
      const acb = lvIncomerFor(kVA, rules.breaker.ratingsA, rules.voltageLL);
      lv.flcA = acb.flcA;
      lv.acbA = acb.acbA;
      lv.setting = acb.setting;
      if (acb.acbA === null) notes.push(`full-load current ${acb.flcA.toFixed(0)} A is above the largest listed rating`);
    }
  }
  if (!rules.meters) notes.push('meter table not verified yet');
  else {
    lv.ctMeter = ctMeterFor(mdKW, rules.meters);
    if (lv.ctMeter.kind === null) notes.push(lv.ctMeter.reason);
  }
  return lv;
}

export const cableText = (row: CableRow) => `${row.runs}x4C ${row.sizeMm2}`;
export const eccText = (runs: number, mm2: number) => `${runs}x1C ${mm2}`;
export const meterText = (pick: MeterPick | null) =>
  !pick || pick.kind === null ? '' : pick.kind === 'CT' ? `${pick.ratio}/5A CTM${pick.checkMeter ? ' + check meter' : ''}` : pick.kind === '1PH' ? '1-phase direct' : '3-phase direct';
