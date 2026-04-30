import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Download,
  FileDown,
  FileUp,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Users
} from "lucide-react";
import { createDefaultState, createDemoState, createResident, defaultRotations } from "./data/defaults";
import { downloadJson, exportScheduleXlsx } from "./lib/export";
import { generateSchedule } from "./lib/generator";
import {
  applyPtoToAssignments,
  assignmentFor,
  blockLabel,
  describeCell,
  ensureAssignmentShape,
  getElectiveLabel,
  getSegmentRotation,
  orderedBlocks,
  setElectiveLabel,
  setFullAssignment
} from "./lib/schedule";
import { hasErrors, validateSchedule } from "./lib/validation";
import type { AppState, Block, Diagnostic, PgyLevel, PtoSelection, Resident, Rotation } from "./types";

const STORAGE_KEY = "resident-schedule-maker-state-v1";

function normalizeRotations(rotations: Rotation[] | undefined): Rotation[] {
  const existing = rotations ?? [];
  const existingById = new Map(existing.map((rotation) => [rotation.id, rotation]));
  const defaultIds = new Set(defaultRotations.map((rotation) => rotation.id));
  const builtIns = defaultRotations.map((defaultRotation) => {
    const current = existingById.get(defaultRotation.id);
    return current ? { ...current, name: defaultRotation.name, builtIn: true } : defaultRotation;
  });
  const custom = existing.filter((rotation) => !defaultIds.has(rotation.id));

  return [...builtIns, ...custom];
}

function normalizeState(state: AppState): AppState {
  return ensureAssignmentShape({
    ...state,
    rotations: normalizeRotations(state.rotations)
  });
}

function loadInitialState(): AppState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return createDefaultState();

  try {
    const parsed = JSON.parse(saved) as AppState;
    return normalizeState(parsed);
  } catch {
    return createDefaultState();
  }
}

function parseBlockParts(name: string, fallback: Pick<Block, "number" | "letter">) {
  const match = /^(\d+)([AB])$/i.exec(name.trim());
  if (!match) return fallback;
  return { number: Number(match[1]), letter: match[2].toUpperCase() as "A" | "B" };
}

function makeBlock(order: number): Block {
  const number = Math.floor(order / 2) + 1;
  const letter = order % 2 === 0 ? "A" : "B";
  const name = `${number}${letter}`;
  return {
    id: `block-${crypto.randomUUID().slice(0, 8)}`,
    name,
    startDate: "",
    endDate: "",
    order,
    number,
    letter
  };
}

function makeCustomRotation(): Rotation {
  const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: "Custom Rotation",
    builtIn: false,
    minPerBlock: 0,
    maxPerBlock: 20,
    canSplitWithHalfPto: false
  };
}

function severityIcon(severity: Diagnostic["severity"]) {
  if (severity === "error") return <AlertCircle aria-hidden="true" size={16} />;
  if (severity === "warning") return <AlertCircle aria-hidden="true" size={16} />;
  return <CheckCircle2 aria-hidden="true" size={16} />;
}

export default function App() {
  const [state, setState] = useState<AppState>(loadInitialState);
  const [generationDiagnostics, setGenerationDiagnostics] = useState<Diagnostic[] | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const diagnostics = useMemo(() => generationDiagnostics ?? validateSchedule(state), [generationDiagnostics, state]);
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const blocks = orderedBlocks(state);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const updateState = (updater: (current: AppState) => AppState) => {
    setGenerationDiagnostics(null);
    setState((current) => ensureAssignmentShape(updater(current)));
  };

  const setAndSyncPto = (updater: (current: AppState) => AppState) => {
    setGenerationDiagnostics(null);
    setState((current) => applyPtoToAssignments(ensureAssignmentShape(updater(current))));
  };

  const handleGenerate = () => {
    const result = generateSchedule(state);
    setState(result.state);
    setGenerationDiagnostics(result.diagnostics);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text) as AppState;
    setState(normalizeState(parsed));
    setGenerationDiagnostics(null);
    event.target.value = "";
  };

  const addResident = () => {
    updateState((current) => ({
      ...current,
      residents: [...current.residents, createResident("New Resident", 2, false, current.blocks)]
    }));
  };

  const updateResident = (residentId: string, patch: Partial<Resident>) => {
    updateState((current) => ({
      ...current,
      residents: current.residents.map((resident) => (resident.id === residentId ? { ...resident, ...patch } : resident))
    }));
  };

  const updatePto = (residentId: string, blockId: string, selection: PtoSelection) => {
    setAndSyncPto((current) => ({
      ...current,
      residents: current.residents.map((resident) =>
        resident.id === residentId
          ? { ...resident, ptoByBlock: { ...resident.ptoByBlock, [blockId]: selection } }
          : resident
      )
    }));
  };

  const deleteResident = (residentId: string) => {
    updateState((current) => ({
      ...current,
      residents: current.residents.filter((resident) => resident.id !== residentId),
      assignments: Object.fromEntries(Object.entries(current.assignments).filter(([id]) => id !== residentId))
    }));
  };

  const updateRequirement = (key: keyof AppState["requirements"], value: number) => {
    updateState((current) => ({
      ...current,
      requirements: { ...current.requirements, [key]: Math.max(0, value) }
    }));
  };

  const updateRotation = (rotationId: string, patch: Partial<Rotation>) => {
    updateState((current) => ({
      ...current,
      rotations: current.rotations.map((rotation) => (rotation.id === rotationId ? { ...rotation, ...patch } : rotation))
    }));
  };

  const deleteRotation = (rotationId: string) => {
    updateState((current) => ({
      ...current,
      rotations: current.rotations.filter((rotation) => rotation.id !== rotationId)
    }));
  };

  const updateBlock = (blockId: string, patch: Partial<Block>) => {
    updateState((current) => ({
      ...current,
      blocks: current.blocks
        .map((block) => {
          if (block.id !== blockId) return block;
          const name = patch.name ?? block.name;
          return { ...block, ...patch, ...parseBlockParts(name, block) };
        })
        .sort((a, b) => a.order - b.order)
    }));
  };

  const addBlock = () => {
    setAndSyncPto((current) => {
      const nextBlock = makeBlock(current.blocks.length);
      return {
        ...current,
        blocks: [...current.blocks, nextBlock],
        residents: current.residents.map((resident) => ({
          ...resident,
          ptoByBlock: { ...resident.ptoByBlock, [nextBlock.id]: "none" }
        }))
      };
    });
  };

  const deleteBlock = (blockId: string) => {
    setAndSyncPto((current) => ({
      ...current,
      blocks: current.blocks.filter((block) => block.id !== blockId).map((block, order) => ({ ...block, order })),
      residents: current.residents.map((resident) => {
        const { [blockId]: _removed, ...ptoByBlock } = resident.ptoByBlock;
        return { ...resident, ptoByBlock };
      })
    }));
  };

  const setAssignment = (residentId: string, blockId: string, rotationId: string) => {
    updateState((current) => setFullAssignment(current, residentId, blockId, rotationId));
  };

  const setAssignmentElectiveLabel = (residentId: string, blockId: string, label: string) => {
    updateState((current) => setElectiveLabel(current, residentId, blockId, label));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Resident Schedule Maker</p>
          <h1>Academic Year 2026-2027</h1>
        </div>
        <div className="topbar-actions">
          <button className="button primary" type="button" onClick={handleGenerate} title="Generate schedule">
            <Sparkles aria-hidden="true" size={18} />
            Generate
          </button>
          <button className="button" type="button" onClick={() => setState(createDemoState())} title="Load demo cohort">
            <Users aria-hidden="true" size={18} />
            Demo
          </button>
          <button className="button" type="button" onClick={() => setState(createDefaultState())} title="Reset app state">
            <RefreshCcw aria-hidden="true" size={18} />
            Reset
          </button>
          <button className="button" type="button" onClick={() => exportScheduleXlsx(state, diagnostics)} title="Export XLSX">
            <FileDown aria-hidden="true" size={18} />
            XLSX
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => downloadJson(state)}
            title="Export JSON"
            aria-label="Export schedule as JSON"
          >
            <Download aria-hidden="true" size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => importRef.current?.click()}
            title="Import JSON"
            aria-label="Import schedule from JSON"
          >
            <FileUp aria-hidden="true" size={18} />
          </button>
          <input ref={importRef} className="visually-hidden" type="file" accept="application/json" onChange={handleImport} />
        </div>
      </header>

      <section className={`status-strip ${hasErrors(diagnostics) ? "has-errors" : "is-valid"}`}>
        <div>
          <strong>{hasErrors(diagnostics) ? "Needs attention" : "Valid schedule"}</strong>
          <span>
            {errorCount} errors, {warningCount} warnings
          </span>
        </div>
        <div>
          <span>{state.residents.length} residents</span>
          <span>{state.blocks.length} blocks</span>
          <span>{state.rotations.length} rotations</span>
        </div>
      </section>

      <section className="workspace">
        <aside className="control-column">
          <ResidentsPanel
            state={state}
            blocks={blocks}
            onAdd={addResident}
            onUpdate={updateResident}
            onDelete={deleteResident}
            onPtoChange={updatePto}
          />
          <RulesPanel state={state} onRequirementChange={updateRequirement} />
          <RotationsPanel state={state} onUpdate={updateRotation} onAdd={() => updateState((current) => ({ ...current, rotations: [...current.rotations, makeCustomRotation()] }))} onDelete={deleteRotation} />
          <BlocksPanel blocks={blocks} onAdd={addBlock} onUpdate={updateBlock} onDelete={deleteBlock} />
          <button className="button primary full-width-action" type="button" onClick={addResident} aria-label="Add resident at bottom">
            <Plus aria-hidden="true" size={18} />
            Add resident
          </button>
        </aside>

        <section className="schedule-column">
          <section className="panel schedule-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Schedule</p>
                <h2>Resident x Block Grid</h2>
              </div>
              <CalendarDays aria-hidden="true" size={22} />
            </div>
            <ScheduleGrid
              state={state}
              blocks={blocks}
              onAssignmentChange={setAssignment}
              onElectiveLabelChange={setAssignmentElectiveLabel}
            />
          </section>

          <DiagnosticsPanel diagnostics={diagnostics} />
        </section>
      </section>
    </main>
  );
}

interface ResidentsPanelProps {
  state: AppState;
  blocks: Block[];
  onAdd: () => void;
  onUpdate: (residentId: string, patch: Partial<Resident>) => void;
  onDelete: (residentId: string) => void;
  onPtoChange: (residentId: string, blockId: string, selection: PtoSelection) => void;
}

function ResidentsPanel({ state, blocks, onAdd, onUpdate, onDelete, onPtoChange }: ResidentsPanelProps) {
  const [expandedPto, setExpandedPto] = useState<Record<string, boolean>>({});

  const togglePto = (residentId: string) => {
    setExpandedPto((current) => ({ ...current, [residentId]: !current[residentId] }));
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Setup</p>
          <h2>Residents & PTO</h2>
        </div>
        <button className="icon-button" type="button" onClick={onAdd} title="Add resident" aria-label="Add resident">
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>

      {state.residents.length === 0 ? (
        <p className="empty-state">Add residents or load the demo cohort to start scheduling.</p>
      ) : (
        <div className="resident-list">
          {state.residents.map((resident) => (
            <div className="resident-row" key={resident.id}>
              <div className="resident-fields">
                <input
                  aria-label="Resident name"
                  value={resident.name}
                  onChange={(event) => onUpdate(resident.id, { name: event.target.value })}
                />
                <select
                  aria-label="PGY level"
                  value={resident.pgyLevel}
                  onChange={(event) => onUpdate(resident.id, { pgyLevel: Number(event.target.value) as PgyLevel })}
                >
                  <option value={2}>PGY2</option>
                  <option value={3}>PGY3</option>
                </select>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={resident.isChief}
                    onChange={(event) => onUpdate(resident.id, { isChief: event.target.checked })}
                  />
                  Chief
                </label>
                <button
                  className="icon-button danger"
                  type="button"
                  onClick={() => onDelete(resident.id)}
                  title="Delete resident"
                  aria-label={`Delete ${resident.name || "resident"}`}
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </div>
              <div className="resident-bottom-actions">
                <button
                  className="button compact-button"
                  type="button"
                  onClick={() => togglePto(resident.id)}
                  aria-expanded={Boolean(expandedPto[resident.id])}
                  title={`${expandedPto[resident.id] ? "Hide" : "Show"} PTO for ${resident.name}`}
                >
                  <CalendarDays aria-hidden="true" size={16} />
                  {expandedPto[resident.id] ? "Hide PTO" : "Show PTO"}
                </button>
              </div>
              {expandedPto[resident.id] && (
                <div className="pto-strip" aria-label={`${resident.name} PTO selections`}>
                  {blocks.map((block) => (
                    <label key={block.id}>
                      <span>{block.name}</span>
                      <select
                        value={resident.ptoByBlock[block.id] ?? "none"}
                        onChange={(event) => onPtoChange(resident.id, block.id, event.target.value as PtoSelection)}
                      >
                        <option value="none">None</option>
                        <option value="full">Full PTO</option>
                        <option value="first-half">H1 PTO</option>
                        <option value="second-half">H2 PTO</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RulesPanel({ state, onRequirementChange }: { state: AppState; onRequirementChange: (key: keyof AppState["requirements"], value: number) => void }) {
  const fields: Array<[keyof AppState["requirements"], string]> = [
    ["pgy2Medicine", "PGY2 Medicine"],
    ["pgy2Nights", "PGY2 Nights"],
    ["pgy2FamilyMedicine", "PGY2 Family Med"],
    ["pgy2Elective", "PGY2 Elective"],
    ["pgy3Medicine", "PGY3 Medicine before 10A"],
    ["pgy3Nights", "PGY3 Nights before 10A"],
    ["pgy3FamilyMedicine", "PGY3 Family Med"],
    ["pgy3Elective", "PGY3 Elective"]
  ];

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Rules</p>
          <h2>Counts</h2>
        </div>
      </div>
      <div className="rule-grid">
        {fields.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={state.requirements[key]}
              onChange={(event) => onRequirementChange(key, Number(event.target.value))}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

interface RotationsPanelProps {
  state: AppState;
  onUpdate: (rotationId: string, patch: Partial<Rotation>) => void;
  onAdd: () => void;
  onDelete: (rotationId: string) => void;
}

function RotationsPanel({ state, onUpdate, onAdd, onDelete }: RotationsPanelProps) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Capacity</p>
          <h2>Rotations</h2>
        </div>
        <button className="icon-button" type="button" onClick={onAdd} title="Add custom rotation" aria-label="Add custom rotation">
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="compact-table-wrap" role="region" aria-label="Rotation capacity settings" tabIndex={0}>
        <table className="compact-table">
          <thead>
            <tr>
              <th>Rotation</th>
              <th>Min</th>
              <th>Max</th>
              <th>Split</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {state.rotations.map((rotation) => (
              <tr key={rotation.id}>
                <td>
                  <input
                    value={rotation.name}
                    disabled={rotation.builtIn}
                    onChange={(event) => onUpdate(rotation.id, { name: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={rotation.minPerBlock}
                    onChange={(event) => onUpdate(rotation.id, { minPerBlock: Number(event.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={rotation.maxPerBlock}
                    onChange={(event) => onUpdate(rotation.id, { maxPerBlock: Number(event.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={rotation.canSplitWithHalfPto}
                    onChange={(event) => onUpdate(rotation.id, { canSplitWithHalfPto: event.target.checked })}
                    aria-label={`${rotation.name} can split with PTO`}
                  />
                </td>
                <td>
                  {!rotation.builtIn && (
                    <button
                      className="icon-button danger"
                      type="button"
                      onClick={() => onDelete(rotation.id)}
                      title="Delete rotation"
                      aria-label={`Delete ${rotation.name}`}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BlocksPanel({
  blocks,
  onAdd,
  onUpdate,
  onDelete
}: {
  blocks: Block[];
  onAdd: () => void;
  onUpdate: (blockId: string, patch: Partial<Block>) => void;
  onDelete: (blockId: string) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Year</p>
          <h2>Blocks</h2>
        </div>
        <button className="icon-button" type="button" onClick={onAdd} title="Add block" aria-label="Add block">
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="compact-table-wrap short" role="region" aria-label="Block date settings" tabIndex={0}>
        <table className="compact-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Start</th>
              <th>End</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => (
              <tr key={block.id}>
                <td>
                  <input value={block.name} onChange={(event) => onUpdate(block.id, { name: event.target.value })} />
                </td>
                <td>
                  <input type="date" value={block.startDate} onChange={(event) => onUpdate(block.id, { startDate: event.target.value })} />
                </td>
                <td>
                  <input type="date" value={block.endDate} onChange={(event) => onUpdate(block.id, { endDate: event.target.value })} />
                </td>
                <td>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => onDelete(block.id)}
                    title="Delete block"
                    aria-label={`Delete block ${block.name}`}
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScheduleGrid({
  state,
  blocks,
  onAssignmentChange,
  onElectiveLabelChange
}: {
  state: AppState;
  blocks: Block[];
  onAssignmentChange: (residentId: string, blockId: string, rotationId: string) => void;
  onElectiveLabelChange: (residentId: string, blockId: string, label: string) => void;
}) {
  const fullOptions = state.rotations;
  const splitOptions = state.rotations.filter((rotation) => rotation.canSplitWithHalfPto);

  if (state.residents.length === 0) {
    return <p className="empty-state">No residents yet.</p>;
  }

  return (
    <div className="schedule-wrap" role="region" aria-label="Resident block schedule grid" tabIndex={0}>
      <table className="schedule-grid">
        <thead>
          <tr>
            <th className="sticky-col resident-head">Resident</th>
            {blocks.map((block) => (
              <th key={block.id} title={blockLabel(block)}>
                <span>{block.name}</span>
                <small>
                  {block.startDate && block.endDate ? `${block.startDate.slice(5)}-${block.endDate.slice(5)}` : "Dates TBD"}
                </small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.residents.map((resident) => (
            <tr key={resident.id}>
              <th className="sticky-col">
                <span>{resident.name || "Unnamed"}</span>
                <small>
                  PGY{resident.pgyLevel}
                  {resident.isChief ? " Chief" : ""}
                </small>
              </th>
              {blocks.map((block) => {
                const cell = assignmentFor(state, resident.id, block.id);
                const pto = resident.ptoByBlock[block.id] ?? "none";
                const options = pto === "none" ? fullOptions : splitOptions;
                const value = getSegmentRotation(cell);
                const electiveLabel = getElectiveLabel(cell);
                return (
                  <td key={block.id}>
                    {pto === "full" ? (
                      <span className="pto-pill">PTO</span>
                    ) : (
                      <select
                        aria-label={`${resident.name} ${block.name} assignment`}
                        value={value}
                        title={describeCell(cell, state.rotations)}
                        onChange={(event) => onAssignmentChange(resident.id, block.id, event.target.value)}
                      >
                        <option value="">{pto === "none" ? "Open" : "Half open"}</option>
                        {options.map((rotation) => (
                          <option key={rotation.id} value={rotation.id}>
                            {rotation.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {value === "elective" && (
                      <input
                        className="elective-label-input"
                        aria-label={`${resident.name} ${block.name} elective label`}
                        placeholder="Elective name"
                        value={electiveLabel}
                        onChange={(event) => onElectiveLabelChange(resident.id, block.id, event.target.value)}
                      />
                    )}
                    {pto === "first-half" && <small className="half-note">H1 PTO</small>}
                    {pto === "second-half" && <small className="half-note">H2 PTO</small>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <section className="panel diagnostics-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Validation</p>
          <h2>Diagnostics</h2>
        </div>
      </div>
      {diagnostics.length === 0 ? (
        <p className="empty-state">No diagnostics.</p>
      ) : (
        <ul className="diagnostic-list">
          {diagnostics.slice(0, 120).map((diagnostic, index) => (
            <li className={`diagnostic ${diagnostic.severity}`} key={`${diagnostic.code}-${index}`}>
              {severityIcon(diagnostic.severity)}
              <div>
                <strong>{diagnostic.code}</strong>
                <p>{diagnostic.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
