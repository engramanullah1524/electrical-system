import { resolveFromClause, usableClause, type LibraryLookup } from '../library/provenance';
import type { UnitType } from '../project/types';
import type { BoardResult } from './engine';
import { circuitWatts, factorValue } from './engine';
import { loadSizingRules, sizeBoards, transformerFor, SIZING_CLAUSES } from './selection';
import type { Board, CableKind, Circuit, Factor, PhaseKW, PointType } from './types';
import { designCurrentA, dropPercent, lookup, tableFromParams, type VdTable } from './voltageDrop';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info' | 'blocked';

export interface CheckResult {
  id: string;
  boardId: string;
  circuitId?: string;
  status: CheckStatus;
  message: string;
  /**
   * The library clauses the check relied on. Empty when it could not run, or when it compares
   * against a project document (such as the DEWA NOC), which the message names instead.
   */
  clauseIds: string[];
}

export interface DesignContext {
  library: LibraryLookup;
  boards: Board[];
  results: Map<string, BoardResult>;
  pointTypes: PointType[];
  /** Design power factor for current calculations, declared by the designer. */
  designPowerFactor: Factor | null;
  /** DEWA NOC connected-load approval per building, in kW. */
  nocKWByBuilding: Record<string, number>;
  /** Current used for sub-main voltage drop: the board's maximum demand, or its full connected load. */
  vdCurrentBasis: 'demand' | 'connected' | null;
  /** The project's demand factor table (entry id → current value). */
  factors?: Map<string, number>;
  /** Residential unit DB types, checked against the final-DB phase imbalance limit. */
  unitTypes?: UnitType[];
  /** The project uses the DEWA-approved 70 mm² ECC with 150 mm² cables. */
  eccPrecedent150?: boolean;
}

/**
 * The library clauses each rule is read from. Building Code first, DEWA 2017 as the fallback — except
 * where the user has designated a source: transformer limits come only from the DEWA note they
 * supplied (checked against the schedule's maximum demand, their decision of 2026-09-19), voltage
 * drop per ampere per metre only from the chart they chose, and phase imbalance from their limits.
 */
const RULES = {
  demandFactorMax: ['dm-dbc-2021/G.4.16.2'],
  mdLimitsFeeder: ['dm-dbc-2021/Table G.15', 'dewa-rei-2017/4.7.2'],
  transformerLimits: ['dewa-transformer-md-note/limits'],
  phaseImbalance: ['designer-sizing-rules/phase-imbalance'],
  vdMax: ['dm-dbc-2021/G.4.7.3', 'dewa-rei-2017/4.2.3'],
  motorApproval: ['dm-dbc-2021/Table G.16', 'dewa-rei-2017/4.7.2'],
  substation: ['dm-dbc-2021/G.4.3', 'dewa-rei-2017/3.1.4'],
  lightingCircuits: ['dm-dbc-2021/G.4.16.1'],
  minConductor: ['dm-dbc-2021/G.4.7.2'],
  airConditioning: ['dm-dbc-2021/G.4.13.8', 'dewa-rei-2017/4.6.6'],
  waterHeater: ['dm-dbc-2021/G.4.13.7'],
  supply: ['dm-dbc-2021/G.4.2', 'dewa-rei-2017/1.2'],
} as const;

const VD_TABLES: Record<CableKind, string> = {
  pvcSheathed: 'dewa-reference-chart-b/vd-pvc-sheathed',
  singleCoreConduit: 'dewa-reference-chart-a/vd-single-core-conduit',
};

type Rule = { ok: true; value: number; clauseId: string } | { ok: false; reason: string };

function readRule(ctx: DesignContext, clauseIds: readonly string[], key: string): Rule {
  const reasons: string[] = [];
  for (const clauseId of clauseIds) {
    const resolved = resolveFromClause(ctx.library, clauseId, key);
    if (resolved.usable && typeof resolved.value === 'number') return { ok: true, value: resolved.value, clauseId };
    reasons.push(resolved.usable ? `${clauseId} does not give a number for ${key}.` : resolved.reason);
  }
  return { ok: false, reason: reasons.join(' ') };
}

const fmt = (n: number, digits = 2) => n.toLocaleString('en-US', { maximumFractionDigits: digits });

export function runChecks(ctx: DesignContext): CheckResult[] {
  const out: CheckResult[] = [];
  const blocked = (id: string, boardId: string, what: string, reason: string, circuitId?: string) =>
    out.push({ id, boardId, circuitId, status: 'blocked', message: `${what} cannot be checked yet: ${reason}`, clauseIds: [] });

  // Demand factors never above the Building Code maximum.
  const dfMax = readRule(ctx, RULES.demandFactorMax, 'demandFactorMax');
  for (const board of ctx.boards) {
    const factors: [string, Factor | null][] = [
      ['circuit demand factor', board.circuitDemandFactor],
      ['factor on sub-boards', board.childFactor],
      ['row factor at the board above', board.rowFactor ?? null],
      ['factor on spare capacity', board.spareFactor],
      ...board.loads.map((l): [string, Factor | null] => [`demand factor of ${l.label}`, l.demandFactor]),
    ];
    for (const [label, factor] of factors) {
      if (!factor) continue;
      const id = `df:${board.id}:${label}`;
      if (!dfMax.ok) blocked(id, board.id, `${board.ref} ${label}`, dfMax.reason);
      else {
        const value = factorValue(factor, ctx.factors);
        if (value > dfMax.value || value < 0)
          out.push({ id, boardId: board.id, status: 'fail', message: `${board.ref}: ${label} ${value} is outside 0–${dfMax.value}.`, clauseIds: [dfMax.clauseId] });
      }
    }
  }

  for (const board of ctx.boards) {
    const result = ctx.results.get(board.id);
    if (!result) continue;

    // Maximum demand against the DEWA limit for a feeder supply.
    if (board.supply?.kind === 'feeder') {
      const limit = readRule(ctx, RULES.mdLimitsFeeder, `mdLimitFeeder${board.supply.amps}A`);
      const id = `md-limit:${board.id}`;
      const supplyText = `${board.supply.amps} A feeder`;
      if (!limit.ok) {
        blocked(id, board.id, `${board.ref} maximum demand on a ${supplyText}`, limit.reason);
      } else {
        const hasMotors = board.loads.some((l) => (l.largestMotorKW ?? 0) > 0);
        out.push({
          id,
          boardId: board.id,
          status: result.demandKW <= limit.value ? 'pass' : 'fail',
          message: `${board.ref}: maximum demand ${fmt(result.demandKW)} kW against ${fmt(limit.value)} kW allowed on a ${supplyText}${hasMotors ? ' (limit is for premises without large motors; see the motor-load rule)' : ''}.`,
          clauseIds: [limit.clauseId],
        });
      }
    }

    // Transformer size: the schedule's maximum demand against the DEWA note's limits.
    const fedByDewa = !board.parentId || !ctx.boards.some((b) => b.id === board.parentId);
    if (board.supply?.kind === 'transformer' || (fedByDewa && board.kind === 'LVP'))
      out.push(transformerCheck(ctx, board, result, board.supply?.kind === 'transformer' ? board.supply.kVA : null));

    // Phase imbalance: under 3% on final DBs, under 10% on SMDBs and MDBs (the user's limits).
    if (board.phases === 3 && result.phaseDeviationPercent !== null)
      out.push(imbalanceCheck(ctx, board.id, board.ref, board.kind === 'DB', result.phaseDeviationPercent));

    // Single motors or compressors above the DEWA approval threshold.
    for (const load of board.loads) {
      if (!load.largestMotorKW) continue;
      const rule = readRule(ctx, RULES.motorApproval, 'singleMotorApprovalAbove');
      const id = `motor:${board.id}:${load.id}`;
      if (!rule.ok) blocked(id, board.id, `${load.label} motor size`, rule.reason);
      else if (load.largestMotorKW > rule.value)
        out.push({ id, boardId: board.id, status: 'warn', message: `${load.label}: a ${fmt(load.largestMotorKW)} kW motor is above ${rule.value} kW, so the connected load on its transformer needs DEWA approval with starting-current details.`, clauseIds: [rule.clauseId] });
    }

    // Each distribution board's incomer must be rated for its connected load before diversity.
    if (board.incomerA && result.connectedKW > 0) {
      const id = `incomer:${board.id}`;
      const voltage = readRule(ctx, RULES.supply, 'nominalVoltageLN');
      if (!voltage.ok) blocked(id, board.id, `${board.ref} incomer rating`, voltage.reason);
      else if (!ctx.designPowerFactor) blocked(id, board.id, `${board.ref} incomer rating`, 'set the design power factor for the project.');
      else {
        const pf = ctx.designPowerFactor.value;
        const worstPhaseKW = Math.max(result.connected.R, result.connected.Y, result.connected.B);
        const amps = board.phases === 1 ? (result.connectedKW * 1000) / (voltage.value * pf) : (worstPhaseKW * 1000) / (voltage.value * pf);
        out.push({
          id,
          boardId: board.id,
          status: board.incomerA >= amps ? 'pass' : 'fail',
          message: `${board.ref}: incomer ${board.incomerA} A against ${fmt(amps, 1)} A at full connected load (${voltage.value} V, power factor ${pf}).`,
          clauseIds: ['dm-dbc-2021/G.4.16.2', voltage.clauseId],
        });
      }
    }

    for (const circuit of board.circuits) out.push(...circuitChecks(ctx, board, circuit));
  }

  for (const type of ctx.unitTypes ?? []) {
    if (type.phases !== 3) continue;
    const deviation = deviationPercent(type.phaseKW);
    if (deviation !== null) out.push(imbalanceCheck(ctx, '', `Unit DB type ${type.name}`, true, deviation));
  }

  out.push(...buildingChecks(ctx));
  out.push(...voltageDropChecks(ctx));
  out.push(...sizingChecks(ctx));
  return out;
}

export function deviationPercent(kw: PhaseKW): number | null {
  const average = (kw.R + kw.Y + kw.B) / 3;
  return average > 0 ? (Math.max(Math.abs(kw.R - average), Math.abs(kw.Y - average), Math.abs(kw.B - average)) / average) * 100 : null;
}

function imbalanceCheck(ctx: DesignContext, boardId: string, name: string, finalDb: boolean, deviation: number): CheckResult {
  const id = `imbalance:${boardId || name}`;
  const limit = readRule(ctx, RULES.phaseImbalance, finalDb ? 'imbalanceMaxPercentFinalDb' : 'imbalanceMaxPercentSmdbMdb');
  if (!limit.ok) return { id, boardId, status: 'blocked', message: `${name} phase imbalance cannot be checked yet: ${limit.reason}`, clauseIds: [] };
  return {
    id,
    boardId,
    status: deviation < limit.value ? 'pass' : 'fail',
    message: `${name}: phase imbalance ${fmt(deviation, 1)}% (largest deviation from the three-phase average), limit below ${limit.value}% for ${finalDb ? 'final DBs' : 'SMDBs and MDBs'}.`,
    clauseIds: [limit.clauseId],
  };
}

/** Problems the automatic breaker, cable, ECC, meter and transformer selection found. */
function sizingChecks(ctx: DesignContext): CheckResult[] {
  if (!ctx.boards.length) return [];
  const out: CheckResult[] = [];
  const rules = loadSizingRules(ctx.library);
  if (rules.blocked.length) {
    out.push({
      id: 'sizing:rules',
      boardId: ctx.boards[0].id,
      status: 'blocked',
      message: `Automatic sizing cannot run in full yet: ${[...new Set(rules.blocked)].join(' ')}`,
      clauseIds: [],
    });
  }
  const sizing = sizeBoards(ctx.boards, ctx.results, rules, { eccPrecedent: ctx.eccPrecedent150 ?? false });
  const real = (notes: string[]) => notes.filter((n) => !/not verified yet/.test(n));
  for (const board of ctx.boards) {
    const s = sizing.get(board.id);
    if (!s) continue;
    const incomer = real(s.incomer?.notes ?? []);
    if (incomer.length) out.push({ id: `sizing:${board.id}`, boardId: board.id, status: 'warn', message: `${board.ref} incomer: ${incomer.join('; ')}.`, clauseIds: rules.clauseIds });
    const lv = real(s.lv?.notes ?? []);
    if (lv.length) out.push({ id: `sizing-lv:${board.id}`, boardId: board.id, status: 'warn', message: `${board.ref}: ${lv.join('; ')}.`, clauseIds: rules.clauseIds });
    for (const load of board.loads) {
      const way = real(s.ways.get(load.id)?.notes ?? []);
      if (way.length) out.push({ id: `sizing:${board.id}:${load.id}`, boardId: board.id, status: 'warn', message: `${board.ref} / ${load.label}: ${way.join('; ')}.`, clauseIds: rules.clauseIds });
    }
  }
  return out;
}

function transformerCheck(ctx: DesignContext, board: Board, result: BoardResult, kVA: number | null): CheckResult {
  const id = `transformer:${board.id}`;
  const blockedResult = (reason: string): CheckResult => ({
    id,
    boardId: board.id,
    status: 'blocked',
    message: `${board.ref} transformer size cannot be checked yet: ${reason}`,
    clauseIds: [],
  });
  const basis = usableClause(ctx.library, SIZING_CLAUSES.lvPanel);
  if (!basis.usable) return blockedResult(basis.reason);
  const clause = usableClause(ctx.library, RULES.transformerLimits[0]);
  if (!clause.usable) return blockedResult(clause.reason);
  const limits: { kVA: number; maxKW: number }[] = [];
  for (const p of clause.clause.params) {
    const match = /^txMdLimit(\d+)kVA$/.exec(p.key);
    if (match && typeof p.value === 'number') limits.push({ kVA: Number(match[1]), maxKW: p.value });
  }
  limits.sort((a, b) => a.kVA - b.kVA);
  const md = result.demandKW;
  const needed = transformerFor(md, limits);
  const clauseIds = [SIZING_CLAUSES.lvPanel, clause.clause.id];
  const neededText = needed
    ? `${needed.kVA} kVA (up to ${fmt(needed.maxKW)} kW)`
    : `more than the largest transformer in the note allows (${fmt(limits[limits.length - 1]?.maxKW ?? 0)} kW), so split the load`;
  if (kVA === null) {
    return { id, boardId: board.id, status: needed ? 'info' : 'fail', message: `${board.ref}: maximum demand ${fmt(md)} kW needs ${neededText}.`, clauseIds };
  }
  const entered = limits.find((l) => l.kVA === kVA);
  if (!entered) return blockedResult(`the DEWA note gives no limit for ${kVA} kVA.`);
  const ok = md <= entered.maxKW;
  return {
    id,
    boardId: board.id,
    status: ok ? 'pass' : 'fail',
    message: `${board.ref}: maximum demand ${fmt(md)} kW against ${fmt(entered.maxKW)} kW allowed on ${kVA} kVA${ok ? '' : `; it needs ${neededText}`}.`,
    clauseIds,
  };
}

/** Cumulative voltage drop from the point of supply (boards fed directly by DEWA) to each circuit's end. */
function voltageDropChecks(ctx: DesignContext): CheckResult[] {
  const anyLengths = ctx.boards.some((b) => b.feeder || b.circuits.some((c) => c.lengthM));
  if (!anyLengths) return [];
  const project = (reason: string): CheckResult[] => [
    { id: 'vd:project', boardId: ctx.boards[0].id, status: 'blocked', message: `Voltage drop cannot be checked yet: ${reason}`, clauseIds: [] },
  ];

  const max = readRule(ctx, RULES.vdMax, 'vdMaxPercent');
  const vLL = readRule(ctx, RULES.supply, 'nominalVoltageLL');
  const vLN = readRule(ctx, RULES.supply, 'nominalVoltageLN');
  if (!max.ok) return project(max.reason);
  if (!vLL.ok) return project(vLL.reason);
  if (!vLN.ok) return project(vLN.reason);
  if (!ctx.designPowerFactor) return project('set the design power factor for the project.');
  if (!ctx.vdCurrentBasis) return project('choose whether sub-main currents use maximum demand or connected load.');
  const pf = ctx.designPowerFactor.value;

  const tables: Partial<Record<CableKind, VdTable>> = {};
  const tableClauses: string[] = [];
  const tableReasons: string[] = [];
  for (const [kind, clauseId] of Object.entries(VD_TABLES) as [CableKind, string][]) {
    const checked = usableClause(ctx.library, clauseId);
    if (checked.usable) {
      tables[kind] = tableFromParams(checked.clause.params);
      tableClauses.push(clauseId);
    } else tableReasons.push(checked.reason);
  }

  const byId = new Map(ctx.boards.map((b) => [b.id, b]));
  const memo = new Map<string, { percent: number } | { reason: string }>();
  const cumulative = (board: Board): { percent: number } | { reason: string } => {
    const known = memo.get(board.id);
    if (known) return known;
    let value: { percent: number } | { reason: string };
    const parent = board.parentId ? byId.get(board.parentId) : undefined;
    if (!parent) value = { percent: 0 }; // point of supply
    else {
      const upstream = cumulative(parent);
      const result = ctx.results.get(board.id);
      if ('reason' in upstream) value = upstream;
      else if (!board.feeder) value = { reason: `no incoming cable is entered for ${board.ref}` };
      else if (!result) value = { reason: `${board.ref} has no load result` };
      else {
        const found = lookup(tables, board.feeder.kind, board.feeder.sizeMm2);
        if (!found.ok) value = { reason: `${board.ref} incoming cable: ${found.reason}${tableReasons.length ? ` (${tableReasons.join(' ')})` : ''}` };
        else {
          const kw = ctx.vdCurrentBasis === 'demand' ? result.demandKW : result.connectedKW;
          const threePhase = board.phases === 3;
          const amps = designCurrentA(kw, threePhase, pf, vLL.value, vLN.value);
          value = {
            percent: upstream.percent + dropPercent(found.mvPerAm, amps, board.feeder.lengthM, board.feeder.runs, threePhase ? vLL.value : vLN.value),
          };
        }
      }
    }
    memo.set(board.id, value);
    return value;
  };

  const out: CheckResult[] = [];
  const watts = new Map(ctx.pointTypes.map((t) => [t.id, t.watts]));
  for (const board of ctx.boards) {
    const upstream = cumulative(board);
    if (board.feeder) {
      out.push(
        'reason' in upstream
          ? { id: `vd-board:${board.id}`, boardId: board.id, status: 'blocked', message: `${board.ref} voltage drop cannot be checked yet: ${upstream.reason}.`, clauseIds: [] }
          : {
              id: `vd-board:${board.id}`,
              boardId: board.id,
              status: upstream.percent <= max.value ? 'pass' : 'fail',
              message: `${board.ref}: ${fmt(upstream.percent)}% voltage drop from the point of supply to this board (limit ${max.value}%).`,
              clauseIds: [max.clauseId, ...tableClauses],
            },
      );
    }
    for (const circuit of board.circuits) {
      if (!circuit.lengthM) continue;
      const id = `vd:${board.id}:${circuit.id}`;
      const name = `${board.ref} circuit ${circuit.no}`;
      if ('reason' in upstream) {
        out.push({ id, boardId: board.id, circuitId: circuit.id, status: 'blocked', message: `${name} voltage drop cannot be checked yet: ${upstream.reason}.`, clauseIds: [] });
        continue;
      }
      const found = lookup(tables, circuit.cableKind, circuit.wireMm2);
      if (!found.ok) {
        out.push({ id, boardId: board.id, circuitId: circuit.id, status: 'blocked', message: `${name} voltage drop cannot be checked yet: ${found.reason}.`, clauseIds: [] });
        continue;
      }
      const threePhase = circuit.phase === 'RYB';
      const amps = designCurrentA(circuitWatts(circuit, watts) / 1000, threePhase, pf, vLL.value, vLN.value);
      const own = dropPercent(found.mvPerAm, amps, circuit.lengthM, 1, threePhase ? vLL.value : vLN.value);
      const total = upstream.percent + own;
      out.push({
        id,
        boardId: board.id,
        circuitId: circuit.id,
        status: total <= max.value ? 'pass' : 'fail',
        message: `${name}: ${fmt(total)}% voltage drop at the circuit end (${fmt(upstream.percent)}% to the board + ${fmt(own)}% in the circuit; limit ${max.value}%).`,
        clauseIds: [max.clauseId, ...tableClauses],
      });
    }
  }
  return out;
}

function categoryCount(circuit: Circuit, types: Map<string, PointType>, ...categories: PointType['category'][]) {
  let points = 0;
  let sockets = 0;
  for (const [typeId, count] of Object.entries(circuit.points)) {
    const type = types.get(typeId);
    if (!type || !count || !categories.includes(type.category)) continue;
    points += count;
    sockets += count * (type.socketsPerPoint || 1);
  }
  return { points, sockets };
}

function circuitChecks(ctx: DesignContext, board: Board, circuit: Circuit): CheckResult[] {
  const out: CheckResult[] = [];
  const types = new Map(ctx.pointTypes.map((t) => [t.id, t]));
  const watts = new Map(ctx.pointTypes.map((t) => [t.id, t.watts]));
  const name = `${board.ref} circuit ${circuit.no}`;
  const push = (suffix: string, status: CheckStatus, message: string, clauseIds: string[]) =>
    out.push({ id: `${suffix}:${board.id}:${circuit.id}`, boardId: board.id, circuitId: circuit.id, status, message, clauseIds });
  const block = (suffix: string, what: string, reason: string) => push(suffix, 'blocked', `${what} cannot be checked yet: ${reason}`, []);

  const lighting = categoryCount(circuit, types, 'lighting', 'fan');
  const others = categoryCount(circuit, types, 'socket13A', 'socket15A', 'ac', 'waterHeater', 'appliance', 'other');
  if (lighting.points > 0 && others.points === 0 && !circuit.equipmentW) {
    const maxW = readRule(ctx, RULES.lightingCircuits, 'lightingCircuitMaxLoad');
    const maxA = readRule(ctx, RULES.lightingCircuits, 'lightingCircuitMaxBreaker');
    const minWire = readRule(ctx, RULES.lightingCircuits, 'lightingCircuitMinWire');
    const loadW = circuitWatts(circuit, watts);
    if (!maxW.ok || !maxA.ok || !minWire.ok) block('lighting', `${name} (lighting)`, [maxW, maxA, minWire].map((r) => (r.ok ? '' : r.reason)).join(' ').trim());
    else {
      const problems = [
        loadW > maxW.value && `load ${fmt(loadW, 0)} W is above ${maxW.value} W`,
        circuit.breakerA !== null && circuit.breakerA > maxA.value && `breaker ${circuit.breakerA} A is above ${maxA.value} A`,
        circuit.wireMm2 !== null && circuit.wireMm2 < minWire.value && `wire ${circuit.wireMm2} mm² is below ${minWire.value} mm²`,
      ].filter(Boolean);
      push('lighting', problems.length ? 'fail' : 'pass', `${name} (lighting): ${problems.length ? problems.join('; ') : `${fmt(loadW, 0)} W within limits`}.`, [maxW.clauseId]);
    }
  }

  const sockets13 = categoryCount(circuit, types, 'socket13A');
  if (sockets13.points > 0) {
    const minWire = readRule(ctx, RULES.minConductor, 'minConductorSocket');
    if (!minWire.ok) block('socket-wire', `${name} socket wiring`, minWire.reason);
    else if (circuit.wireMm2 !== null)
      push('socket-wire', circuit.wireMm2 >= minWire.value ? 'pass' : 'fail', `${name}: socket circuit wire ${circuit.wireMm2} mm² (minimum ${minWire.value} mm²).`, [minWire.clauseId]);

    if (/kitchen/i.test(circuit.area)) {
      push('socket-count', 'info', `${name}: kitchen socket circuits are outside the radial/ring outlet-count rule.`, ['dm-dbc-2021/G.4.16.1']);
    } else if (circuit.breakerA !== null) {
      const ring = circuit.breakerA >= 30;
      const limit = readRule(ctx, RULES.lightingCircuits, ring ? 'ringMaxSockets13A' : 'radialMaxSockets13A');
      if (!limit.ok) block('socket-count', `${name} socket count`, limit.reason);
      else
        push('socket-count', sockets13.sockets <= limit.value ? 'pass' : 'fail', `${name}: ${sockets13.sockets} 13 A socket outlet(s) on a ${ring ? 'ring' : 'radial'} circuit (maximum ${limit.value}).`, [limit.clauseId]);
    }
  }

  if (categoryCount(circuit, types, 'ac').points > 0) {
    const minA = readRule(ctx, RULES.airConditioning, 'acMinBreaker');
    const minWire = readRule(ctx, RULES.airConditioning, 'acMinWire');
    if (!minA.ok || !minWire.ok) block('ac', `${name} (air conditioning)`, [minA, minWire].map((r) => (r.ok ? '' : r.reason)).join(' ').trim());
    else {
      const problems = [
        circuit.breakerA !== null && circuit.breakerA < minA.value && `breaker ${circuit.breakerA} A is below ${minA.value} A`,
        circuit.wireMm2 !== null && circuit.wireMm2 < minWire.value && `wire ${circuit.wireMm2} mm² is below ${minWire.value} mm²`,
      ].filter(Boolean);
      push('ac', problems.length ? 'fail' : 'pass', `${name} (air conditioning): ${problems.length ? problems.join('; ') : 'breaker and wire meet the minimum'}.`, [minA.clauseId]);
    }
  }

  if (categoryCount(circuit, types, 'waterHeater').points > 0) {
    const rcd = readRule(ctx, RULES.waterHeater, 'rcdWaterHeaterCircuit');
    if (!rcd.ok) block('heater-rcd', `${name} water heater RCD`, rcd.reason);
    else
      push(
        'heater-rcd',
        circuit.rcdMA !== null && circuit.rcdMA <= rcd.value ? 'pass' : 'fail',
        `${name}: water heater circuit RCD ${circuit.rcdMA === null ? 'not entered' : `${circuit.rcdMA} mA`} (required ${rcd.value} mA).`,
        [rcd.clauseId],
      );
  }

  return out;
}

function buildingChecks(ctx: DesignContext): CheckResult[] {
  const out: CheckResult[] = [];
  const buildings = new Map<string, Board[]>();
  for (const board of ctx.boards) {
    if (board.parentId) continue;
    buildings.set(board.building, [...(buildings.get(board.building) ?? []), board]);
  }

  for (const [building, tops] of buildings) {
    const connectedKW = tops.reduce((sum, b) => sum + (ctx.results.get(b.id)?.connectedKW ?? 0), 0);
    const anchor = tops[0].id;
    const label = building || 'Building';

    const threshold = readRule(ctx, RULES.substation, 'substationThresholdTCL');
    if (!threshold.ok) out.push({ id: `substation:${building}`, boardId: anchor, status: 'blocked', message: `${label} substation requirement cannot be checked yet: ${threshold.reason}`, clauseIds: [] });
    else
      out.push({
        id: `substation:${building}`,
        boardId: anchor,
        status: 'info',
        message:
          connectedKW > threshold.value
            ? `${label}: total connected load ${fmt(connectedKW)} kW is above ${threshold.value} kW, so space for a DEWA substation must be provided.`
            : `${label}: total connected load ${fmt(connectedKW)} kW is not above ${threshold.value} kW; DEWA may still require a substation.`,
        clauseIds: [threshold.clauseId],
      });

    const noc = ctx.nocKWByBuilding[building];
    if (noc)
      out.push({
        id: `noc:${building}`,
        boardId: anchor,
        status: connectedKW <= noc ? 'pass' : 'fail',
        message: `${label}: total connected load ${fmt(connectedKW)} kW against ${fmt(noc)} kW in the DEWA NOC (${connectedKW <= noc ? `${fmt(noc - connectedKW)} kW headroom` : `${fmt(connectedKW - noc)} kW over`}).`,
        clauseIds: [],
      });
  }
  return out;
}
