import type { AppState, GenerationResult } from "../types";
import { applyPtoToAssignments, ensureAssignmentShape } from "./schedule";
import { hasErrors, validateSchedule } from "./validation";

export function generateSchedule(input: AppState): GenerationResult {
  const state = applyPtoToAssignments(ensureAssignmentShape(structuredClone(input)));
  const diagnostics = validateSchedule(state);

  return {
    state,
    diagnostics,
    success: !hasErrors(diagnostics)
  };
}

export function requiredCoverageBlocks() {
  return [];
}
