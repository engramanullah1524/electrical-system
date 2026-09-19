import type { Board, BoardKind, DemandFactorEntry, DirectLoad, Factor } from '../design/types';
import { linkedFactor } from '../project/factors';
import { sameName, type SheetGrid } from './grid';
import { isSummarySheet, parsePanelSheet, type PanelSheet, type WayRow } from './templateB';

export interface ImportPlan {
  boards: Board[];
  /** Arithmetic problems in the workbook itself. */
  findings: string[];
  /** Everything the import decided that the user should confirm. */
  suggestions: string[];
  /** Sheets not imported, and why. */
  skipped: string[];
  summaries: { name: string; totalKW: number }[];
}

/**
 * Factor suggestions from way names, following the load types the user named (2026-09-18).
 * They link to the project's factor table, so the user can change them later in one place.
 */
const FACTOR_RULES: [RegExp, string, string][] = [
  [/SPARE/, 'spareAtPanel', 'spare way'],
  [/FIRE.*PUMP/, 'dfPumps', 'fire pump'],
  [/IRRIGATION/, 'dfIrrigationPumps', 'irrigation pumps'],
  [/POOL/, 'dfSwimmingPool', 'swimming pool'],
  [/(^|[^A-Z])EV([^A-Z]|$)/, 'dfEvCharger', 'EV chargers'],
  [/EMDB|ESMDB/, 'dfEmdb', 'emergency board (EMDB/ESMDB)'],
  [/SMDB[-\s]*(GF|RF)/, 'dfLandlordServices', 'common-area SMDB'],
  [/SMDB[-\s]*\d+\s*F/, 'dfResidentialSmdb', 'residential floor SMDB'],
  [/DB[-\s]*SS|SUBSTATION/, 'dfDbSubstation', 'substation DB'],
  [/MCC|CHWP|PUMP/, 'dfPumps', 'pumps'],
  [/O?AHU/, 'dfAhuOahu', 'AHU / OAHU'],
  [/FAN/, 'dfExtractMakeupFans', 'fans'],
];

const unsetFactor = (): Factor => ({ value: 1, basis: { kind: 'declared', reason: '' } });

function kindFor(name: string): BoardKind {
  const n = name.toUpperCase();
  if (/^LV\s*PANEL|^LVP/.test(n)) return 'LVP';
  if (/^MAIN\s*DB|^MDB/.test(n)) return 'MDB';
  if (/EMDB/.test(n)) return 'EMDB';
  if (/MCC/.test(n)) return 'MCC';
  if (/SMDB/.test(n)) return 'SMDB';
  return 'DB';
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

function auditPanel(panel: PanelSheet, findings: string[]) {
  for (const w of panel.ways) {
    const phases = w.R + w.Y + w.B;
    if (Math.abs(phases - w.total) > 0.01) findings.push(`${panel.name} / ${w.label}: R + Y + B = ${fmt(phases)} kW but the row total is ${fmt(w.total)} kW.`);
  }
  for (const k of ['R', 'Y', 'B', 'total'] as const) {
    const sum = panel.ways.reduce((s, w) => s + w[k], 0);
    if (Math.abs(sum - panel.totals[k]) > 0.01) findings.push(`${panel.name}: the ${k} total is ${fmt(panel.totals[k])} kW but its rows add up to ${fmt(sum)} kW.`);
  }
  const f = panel.footer;
  if (f.df !== null && f.actual !== null && f.md !== null && Math.abs(f.df * f.actual - f.md) > 0.01) {
    findings.push(`${panel.name}: maximum demand ${fmt(f.md)} kW is not factor ${f.df} × actual connected ${fmt(f.actual)} kW.`);
  }
}

export function planImport(
  sheets: SheetGrid[],
  options: { projectId: string; file: string; factors: DemandFactorEntry[]; buildingFor: (sheet: string) => string; today: string },
): ImportPlan {
  const findings: string[] = [];
  const suggestions: string[] = [];
  const skipped: string[] = [];
  const summaries: ImportPlan['summaries'] = [];
  const panels: PanelSheet[] = [];

  for (const sheet of sheets) {
    const panel = parsePanelSheet(sheet);
    if (!panel) {
      skipped.push(sheet.name);
      continue;
    }
    if (isSummarySheet(sheet.name)) summaries.push({ name: sheet.name, totalKW: panel.totals.total });
    else panels.push(panel);
  }

  const entry = (id: string) => options.factors.find((f) => f.id === id);
  const boards = new Map<string, Board>();
  for (const panel of panels) {
    auditPanel(panel, findings);
    boards.set(panel.name, {
      id: crypto.randomUUID(),
      projectId: options.projectId,
      building: options.buildingFor(panel.name),
      ref: panel.name,
      kind: kindFor(panel.name),
      parentId: null,
      supply: null,
      phases: 3,
      incomerDevice: '',
      incomerA: null,
      faultKA: null,
      cable: '',
      eccMm2: null,
      lengthM: null,
      feeder: null,
      loadCategory: null,
      circuitDemandFactor: null,
      childFactor: null,
      spareFactor: null,
      circuits: [],
      loads: [],
      meters: { singlePhase: 0, threePhase: 0, ct: 0 },
      location: '',
      remarks: panel.footer.standby ? `Workbook footer states ${fmt(panel.footer.standby)} kW standby.` : '',
      source: { file: options.file, sheet: panel.name, importedOn: options.today },
    });
  }

  /** A factor suggested from the way's name, linked to the project's factor table. */
  const suggestFactor = (panel: PanelSheet, way: WayRow): Factor => {
    const name = way.label.toUpperCase();
    const rule = FACTOR_RULES.find(([re]) => re.test(name));
    const factorEntry = rule ? entry(rule[1]) : undefined;
    if (rule && factorEntry) suggestions.push(`${panel.name} / ${way.label}: factor "${factorEntry.label}" (${factorEntry.value}) suggested as ${rule[2]}.`);
    else if (rule) suggestions.push(`${panel.name} / ${way.label}: looks like ${rule[2]}, but the factor table has no "${rule[1]}" entry. Load the library factors first.`);
    else suggestions.push(`${panel.name} / ${way.label}: no factor suggested; choose one.`);
    return factorEntry ? linkedFactor(factorEntry) : unsetFactor();
  };

  const toLoad = (panel: PanelSheet, way: WayRow): DirectLoad => {
    const name = way.label.toUpperCase();
    const demandFactor = suggestFactor(panel, way);
    const fire = /FIRE.*PUMP/.test(name);
    if (fire) suggestions.push(`${panel.name} / ${way.label}: marked standby (${fmt(way.total)} kW), so it stays out of maximum and transformer demand.`);
    const described = [way.device && way.ratingA ? `${way.device} ${way.ratingA} A` : '', way.cable, way.ecc && `ECC ${way.ecc}`].filter(Boolean).join(', ');
    return {
      id: crypto.randomUUID(),
      label: way.label,
      kind: /SPARE/.test(name) ? 'spare' : 'equipment',
      category: null,
      phaseKW: { R: way.R, Y: way.Y, B: way.B },
      demandFactor,
      standbyKW: fire ? way.R + way.Y + way.B : 0,
      largestMotorKW: null,
      remarks: [described, `row ${way.row}`].filter(Boolean).join('; '),
    };
  };

  for (const panel of panels) {
    const board = boards.get(panel.name)!;
    for (const way of panel.ways) {
      const child = panels.find((p) => p !== panel && sameName(p.name, way.label));
      const childBoard = child && boards.get(child.name);
      if (childBoard && !childBoard.parentId) {
        // The way is a board of its own: link it rather than count its load twice. Its row at this
        // panel counts its connected load less standby × the row's factor.
        childBoard.parentId = board.id;
        childBoard.rowFactor = suggestFactor(panel, way);
        if (Math.abs(child.totals.total - way.total) > 0.01) {
          findings.push(`${panel.name} / ${way.label}: the way states ${fmt(way.total)} kW but sheet ${child.name} totals ${fmt(child.totals.total)} kW.`);
        }
        continue;
      }
      if (childBoard) findings.push(`${panel.name} / ${way.label}: sheet ${child!.name} is already fed from another board; counted here as a load.`);
      board.loads.push(toLoad(panel, way));
    }
  }

  // Spares count in full at their panel and at the main-board factor where boards are fed by DEWA.
  const spareMain = entry('spareAtMainBoard');
  for (const board of boards.values()) {
    if (board.parentId) continue;
    if (spareMain) {
      board.spareFactor = linkedFactor(spareMain);
      suggestions.push(`${board.ref}: fed by DEWA, so spares aggregate here at "${spareMain.label}" (${spareMain.value}).`);
    }
    suggestions.push(`${board.ref}: enter the DEWA transformer kVA (not in the workbook) in its board editor.`);
  }

  return { boards: [...boards.values()], findings, suggestions, skipped, summaries };
}
