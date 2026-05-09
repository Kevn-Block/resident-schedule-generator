import type { AppState, Diagnostic } from "../types";
import {
  assignmentFor,
  cellContainsPto,
  cellCredit,
  hasFullBlockRotation,
  orderedBlocks,
  rotationCreditsByBlock,
  rotationById
} from "./schedule";

function pushDiagnostic(
  diagnostics: Diagnostic[],
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  context: Partial<Diagnostic> = {}
) {
  diagnostics.push({ severity, code, message, ...context });
}

function validatePtoAndSplitGuardrails(state: AppState, diagnostics: Diagnostic[]) {
  for (const resident of state.residents) {
    for (const block of orderedBlocks(state)) {
      const cell = assignmentFor(state, resident.id, block.id);
      const pto = resident.ptoByBlock[block.id] ?? "none";

      if (pto === "full") {
        const hasRotation = cell.firstHalf.kind === "rotation" || cell.secondHalf.kind === "rotation";
        if (hasRotation) {
          pushDiagnostic(
            diagnostics,
            "error",
            "pto.full-conflict",
            `${resident.name} has full-block PTO in ${block.name} but also has a rotation assignment.`,
            { residentId: resident.id, blockId: block.id }
          );
        }
      }

      if (cellContainsPto(cell)) {
        for (const segment of [cell.firstHalf, cell.secondHalf]) {
          if (segment.kind !== "rotation" || !segment.rotationId) continue;
          const rotation = rotationById(state.rotations, segment.rotationId);
          if (!rotation?.canSplitWithHalfPto) {
            pushDiagnostic(
              diagnostics,
              "error",
              "pto.split-ineligible",
              `${resident.name} has ${rotation?.name ?? segment.rotationId} split with PTO in ${block.name}, but that rotation is not split-eligible.`,
              { residentId: resident.id, blockId: block.id, rotationId: segment.rotationId }
            );
          }
        }
      }
    }
  }
}

function validateCapacity(state: AppState, diagnostics: Diagnostic[]) {
  for (const block of orderedBlocks(state)) {
    for (const rotation of state.rotations) {
      const credit = rotationCreditsByBlock(state, block.id, rotation.id);
      if (credit + 0.001 < rotation.minPerBlock) {
        pushDiagnostic(
          diagnostics,
          "error",
          "capacity.min",
          `${block.name} has ${credit.toFixed(1)} ${rotation.name} FTE but needs at least ${rotation.minPerBlock}.`,
          { blockId: block.id, rotationId: rotation.id }
        );
      }
      if (credit - 0.001 > rotation.maxPerBlock) {
        pushDiagnostic(
          diagnostics,
          "error",
          "capacity.max",
          `${block.name} has ${credit.toFixed(1)} ${rotation.name} FTE but allows at most ${rotation.maxPerBlock}.`,
          { blockId: block.id, rotationId: rotation.id }
        );
      }
    }
  }
}

function rotationCreditForResident(state: AppState, residentId: string, rotationId: string): number {
  return orderedBlocks(state).reduce((sum, block) => sum + cellCredit(state.assignments[residentId]?.[block.id], rotationId), 0);
}

function fullBlockRunsForResident(state: AppState, residentId: string, rotationId: string) {
  const runs: Array<{ blocks: string[]; length: number }> = [];
  let current: string[] = [];

  for (const block of orderedBlocks(state)) {
    if (hasFullBlockRotation(state.assignments[residentId]?.[block.id], rotationId)) {
      current.push(block.name);
    } else if (current.length > 0) {
      runs.push({ blocks: current, length: current.length });
      current = [];
    }
  }

  if (current.length > 0) {
    runs.push({ blocks: current, length: current.length });
  }

  return runs;
}

function formatRuns(runs: Array<{ blocks: string[]; length: number }>) {
  return runs.length ? runs.map((run) => `${run.length} (${run.blocks.join("+")})`).join(", ") : "none";
}

function validatePgy1TypeRequirements(
  state: AppState,
  diagnostics: Diagnostic[],
  pgy1Type: "fm" | "ty",
  label: string,
  medicineTotal: number,
  medicineDistribution: number[],
  nightsTotal: number,
  distributionDescription: string
) {
  const expectedDistribution = [...medicineDistribution].sort((first, second) => first - second).join(",");

  for (const resident of state.residents.filter((item) => item.pgy1Type === pgy1Type)) {
    const medicineCredit = rotationCreditForResident(state, resident.id, "medicine");
    if (Math.abs(medicineCredit - medicineTotal) > 0.001) {
      pushDiagnostic(
        diagnostics,
        "error",
        `${pgy1Type}.medicine.total`,
        `${resident.name} is ${label} and must complete exactly ${medicineTotal} Medicine blocks; current total is ${medicineCredit.toFixed(1)}.`,
        { residentId: resident.id, rotationId: "medicine" }
      );
    }

    const medicineRuns = fullBlockRunsForResident(state, resident.id, "medicine");
    const distribution = medicineRuns.map((run) => run.length).sort((first, second) => first - second);
    if (distribution.join(",") !== expectedDistribution) {
      pushDiagnostic(
        diagnostics,
        "error",
        `${pgy1Type}.medicine.distribution`,
        `${resident.name} is ${label} and must complete Medicine as ${distributionDescription}; current chunks are ${formatRuns(medicineRuns)}.`,
        { residentId: resident.id, rotationId: "medicine" }
      );
    }

    const nightsCredit = rotationCreditForResident(state, resident.id, "nights");
    if (Math.abs(nightsCredit - nightsTotal) > 0.001) {
      pushDiagnostic(
        diagnostics,
        "error",
        `${pgy1Type}.nights.total`,
        `${resident.name} is ${label} and must complete exactly ${nightsTotal} Nights blocks; current total is ${nightsCredit.toFixed(1)}.`,
        { residentId: resident.id, rotationId: "nights" }
      );
    }
  }
}

function validateResidentTypeRequirements(state: AppState, diagnostics: Diagnostic[]) {
  validatePgy1TypeRequirements(state, diagnostics, "fm", "FM", 5, [2, 2, 1], 3, "two 2-block chunks plus one single block");
  validatePgy1TypeRequirements(state, diagnostics, "ty", "TY", 6, [2, 2, 2], 4, "three 2-block chunks");
}

function blockRotationCredit(state: AppState, blockId: string, rotationId: string): number {
  return state.residents.reduce((sum, resident) => sum + cellCredit(state.assignments[resident.id]?.[blockId], rotationId), 0);
}

function fmBlockRotationCredit(state: AppState, blockId: string, rotationId: string): number {
  return state.residents
    .filter((resident) => resident.pgy1Type === "fm")
    .reduce((sum, resident) => sum + cellCredit(state.assignments[resident.id]?.[blockId], rotationId), 0);
}

function validateBlockCoverage(state: AppState, diagnostics: Diagnostic[]) {
  const rules = [
    { rotationId: "medicine", label: "Days", code: "days", min: 3, max: 4 },
    { rotationId: "nights", label: "Nights", code: "nights", min: 2, max: 3 }
  ] as const;
  const blocks = orderedBlocks(state);

  for (const rule of rules) {
    let earlierAtMinimum = false;

    for (const block of blocks) {
      const credit = blockRotationCredit(state, block.id, rule.rotationId);
      const fmCredit = fmBlockRotationCredit(state, block.id, rule.rotationId);

      if (credit + 0.001 < rule.min) {
        pushDiagnostic(
          diagnostics,
          "error",
          `block.${rule.code}.min`,
          `${block.name} needs at least ${rule.min} PGY1 on ${rule.label}; current total is ${credit.toFixed(1)}.`,
          { blockId: block.id, rotationId: rule.rotationId }
        );
      }

      if (credit - 0.001 > rule.max) {
        pushDiagnostic(
          diagnostics,
          "error",
          `block.${rule.code}.max`,
          `${block.name} allows at most ${rule.max} PGY1 on ${rule.label}; current total is ${credit.toFixed(1)}.`,
          { blockId: block.id, rotationId: rule.rotationId }
        );
      }

      if (fmCredit - 0.001 > 1) {
        pushDiagnostic(
          diagnostics,
          "warning",
          `preference.fm-${rule.code}-balance`,
          `${block.name} has ${fmCredit.toFixed(1)} FM PGY1 on ${rule.label}; prefer at most 1 FM per block when possible.`,
          { blockId: block.id, rotationId: rule.rotationId }
        );
      }

      if (earlierAtMinimum && credit > rule.min + 0.001) {
        pushDiagnostic(
          diagnostics,
          "warning",
          `preference.early-extra-${rule.code}`,
          `${block.name} has ${credit.toFixed(1)} PGY1 on ${rule.label}; extra coverage above the minimum is preferred earlier in the schedule.`,
          { blockId: block.id, rotationId: rule.rotationId }
        );
      }

      if (Math.abs(credit - rule.min) <= 0.001) {
        earlierAtMinimum = true;
      }
    }
  }
}

function medicineNightsRotationsForResidentBlock(state: AppState, residentId: string, blockId: string) {
  const cell = state.assignments[residentId]?.[blockId];
  return {
    medicine: cellCredit(cell, "medicine") > 0,
    nights: cellCredit(cell, "nights") > 0
  };
}

function validateDaysNightsAdjacencyPreference(state: AppState, diagnostics: Diagnostic[]) {
  const blocks = orderedBlocks(state);

  for (const resident of state.residents) {
    for (let index = 0; index < blocks.length - 1; index += 1) {
      const current = blocks[index];
      const next = blocks[index + 1];
      const currentRotations = medicineNightsRotationsForResidentBlock(state, resident.id, current.id);
      const nextRotations = medicineNightsRotationsForResidentBlock(state, resident.id, next.id);
      const daysToNights = currentRotations.medicine && nextRotations.nights;
      const nightsToDays = currentRotations.nights && nextRotations.medicine;

      if (daysToNights || nightsToDays) {
        pushDiagnostic(
          diagnostics,
          "warning",
          "preference.days-nights-adjacency",
          `${resident.name} has adjacent Days and Nights in ${current.name} + ${next.name}; separate Days/Nights transitions when possible.`,
          { residentId: resident.id, blockId: current.id, rotationId: daysToNights ? "medicine" : "nights" }
        );
      }
    }
  }
}

export function validateSchedule(state: AppState): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (state.residents.length === 0) {
    pushDiagnostic(diagnostics, "error", "setup.no-residents", "Add at least one resident before generating a schedule.");
  }

  validatePtoAndSplitGuardrails(state, diagnostics);
  validateCapacity(state, diagnostics);
  validateResidentTypeRequirements(state, diagnostics);
  validateBlockCoverage(state, diagnostics);
  validateDaysNightsAdjacencyPreference(state, diagnostics);

  for (const resident of state.residents) {
    if (!resident.name.trim()) {
      pushDiagnostic(diagnostics, "error", "resident.name-missing", "Every resident needs a name.", { residentId: resident.id });
    }
  }

  return diagnostics;
}

export function hasErrors(diagnostics: Diagnostic[]) {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
