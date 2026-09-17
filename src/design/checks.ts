import { resolveFromClause, type LibraryLookup } from '../library/provenance';
import type { BoardResult } from './engine';
import { circuitWatts } from './engine';
import type { Board, Circuit, Factor, PointType } from './types';

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
}

/** The library clauses each rule is read from: Building Code first, DEWA 2017 as the fallback. */
const RULES = {
  demandFactorMax: ['dm-dbc-2021/G.4.16.2'],
  mdLimits: ['dm-dbc-2021/Table G.15', 'dewa-rei-2017/4.7.2'],
  motorApproval: ['dm-dbc-2021/Table G.16', 'dewa-rei-2017/4.7.2'],
  substation: ['dm-dbc-2021/G.4.3', 'dewa-rei-2017/3.1.4'],
  lightingCircuits: ['dm-dbc-2021/G.4.16.1'],
  minConductor: ['dm-dbc-2021/G.4.7.2'],
  airConditioning: ['dm-dbc-2021/G.4.13.8', 'dewa-rei-2017/4.6.6'],
  waterHeater: ['dm-dbc-2021/G.4.13.7'],
  supply: ['dm-dbc-2021/G.4.2', 'dewa-rei-2017/1.2'],
} as const;

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
      ...board.loads.map((l): [string, Factor | null] => [`demand factor of ${l.label}`, l.demandFactor]),
    ];
    for (const [label, factor] of factors) {
      if (!factor) continue;
      const id = `df:${board.id}:${label}`;
      if (!dfMax.ok) blocked(id, board.id, `${board.ref} ${label}`, dfMax.reason);
      else if (factor.value > dfMax.value || factor.value < 0)
        out.push({ id, boardId: board.id, status: 'fail', message: `${board.ref}: ${label} ${factor.value} is outside 0–${dfMax.value}.`, clauseIds: [dfMax.clauseId] });
    }
  }

  for (const board of ctx.boards) {
    const result = ctx.results.get(board.id);
    if (!result) continue;

    // Maximum demand against the DEWA limit for the supply feeding this board.
    if (board.supply) {
      const key =
        board.supply.kind === 'transformer' ? `mdLimitTransformer${board.supply.kVA}kVA` : `mdLimitFeeder${board.supply.amps}A`;
      const limit = readRule(ctx, RULES.mdLimits, key);
      const id = `md-limit:${board.id}`;
      const supplyText = board.supply.kind === 'transformer' ? `${board.supply.kVA} kVA transformer` : `${board.supply.amps} A feeder`;
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

  out.push(...buildingChecks(ctx));
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
