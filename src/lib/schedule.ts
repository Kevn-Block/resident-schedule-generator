import type {
  AppState,
  AssignmentMatrix,
  AssignmentSegment,
  Block,
  PtoSelection,
  Resident,
  Rotation,
  ScheduleCell
} from "../types";

export const emptySegment: AssignmentSegment = { kind: "empty" };
export const ptoSegment: AssignmentSegment = { kind: "pto" };

export function rotationSegment(rotationId: string, label = ""): AssignmentSegment {
  return rotationId === "elective" && label ? { kind: "rotation", rotationId, label } : { kind: "rotation", rotationId };
}

function normalizeSegment(segment: AssignmentSegment | undefined): AssignmentSegment {
  if (!segment || segment.kind === "empty") return emptySegment;
  if (segment.kind === "pto") return ptoSegment;
  if (!segment.rotationId) return emptySegment;
  return rotationSegment(segment.rotationId ?? "", segment.rotationId === "elective" ? segment.label ?? "" : "");
}

export function emptyCell(): ScheduleCell {
  return { firstHalf: emptySegment, secondHalf: emptySegment };
}

export function fullRotationCell(rotationId: string, label = ""): ScheduleCell {
  return { firstHalf: rotationSegment(rotationId, label), secondHalf: rotationSegment(rotationId, label) };
}

export function fullPtoCell(): ScheduleCell {
  return { firstHalf: ptoSegment, secondHalf: ptoSegment };
}

export function ptoCell(selection: PtoSelection): ScheduleCell {
  if (selection === "full") return fullPtoCell();
  if (selection === "first-half") return { firstHalf: ptoSegment, secondHalf: emptySegment };
  if (selection === "second-half") return { firstHalf: emptySegment, secondHalf: ptoSegment };
  return emptyCell();
}

export function createAssignmentMatrix(residents: Resident[], blocks: Block[]): AssignmentMatrix {
  return Object.fromEntries(
    residents.map((resident) => [
      resident.id,
      Object.fromEntries(blocks.map((block) => [block.id, ptoCell(resident.ptoByBlock[block.id] ?? "none")]))
    ])
  );
}

export function cloneState<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeCellForPto(cell: ScheduleCell | undefined, pto: PtoSelection): ScheduleCell {
  if (pto === "full") {
    return fullPtoCell();
  }

  if (pto === "first-half") {
    return {
      firstHalf: ptoSegment,
      secondHalf: cell?.secondHalf.kind === "pto" ? emptySegment : normalizeSegment(cell?.secondHalf)
    };
  }

  if (pto === "second-half") {
    return {
      firstHalf: cell?.firstHalf.kind === "pto" ? emptySegment : normalizeSegment(cell?.firstHalf),
      secondHalf: ptoSegment
    };
  }

  return {
    firstHalf: cell?.firstHalf.kind === "pto" ? emptySegment : normalizeSegment(cell?.firstHalf),
    secondHalf: cell?.secondHalf.kind === "pto" ? emptySegment : normalizeSegment(cell?.secondHalf)
  };
}

export function applyPtoToAssignments(state: AppState): AppState {
  const assignments: AssignmentMatrix = {};

  for (const resident of state.residents) {
    assignments[resident.id] = {};
    const currentResidentAssignments = state.assignments[resident.id] ?? {};
    for (const block of state.blocks) {
      assignments[resident.id][block.id] = normalizeCellForPto(
        currentResidentAssignments[block.id],
        resident.ptoByBlock[block.id] ?? "none"
      );
    }
  }

  return { ...state, assignments };
}

export function ensureAssignmentShape(state: AppState): AppState {
  const assignments: AssignmentMatrix = {};
  for (const resident of state.residents) {
    assignments[resident.id] = {};
    for (const block of state.blocks) {
      const existing = state.assignments[resident.id]?.[block.id];
      assignments[resident.id][block.id] = normalizeCellForPto(existing, resident.ptoByBlock[block.id] ?? "none");
    }
  }

  return { ...state, assignments };
}

export function segmentCredit(segment: AssignmentSegment, rotationId: string): number {
  return segment.kind === "rotation" && segment.rotationId === rotationId ? 0.5 : 0;
}

export function cellCredit(cell: ScheduleCell | undefined, rotationId: string): number {
  if (!cell) return 0;
  return segmentCredit(cell.firstHalf, rotationId) + segmentCredit(cell.secondHalf, rotationId);
}

export function hasAnyRotation(cell: ScheduleCell | undefined, rotationId: string): boolean {
  return cellCredit(cell, rotationId) > 0;
}

export function hasFullBlockRotation(cell: ScheduleCell | undefined, rotationId: string): boolean {
  if (!cell) return false;
  return (
    cell.firstHalf.kind === "rotation" &&
    cell.secondHalf.kind === "rotation" &&
    cell.firstHalf.rotationId === rotationId &&
    cell.secondHalf.rotationId === rotationId
  );
}

export function isEmptyCell(cell: ScheduleCell | undefined): boolean {
  if (!cell) return true;
  return cell.firstHalf.kind === "empty" && cell.secondHalf.kind === "empty";
}

export function isFullPto(cell: ScheduleCell | undefined): boolean {
  if (!cell) return false;
  return cell.firstHalf.kind === "pto" && cell.secondHalf.kind === "pto";
}

export function isHalfPto(cell: ScheduleCell | undefined): boolean {
  if (!cell) return false;
  const ptoCount = [cell.firstHalf, cell.secondHalf].filter((segment) => segment.kind === "pto").length;
  return ptoCount === 1;
}

export function cellContainsPto(cell: ScheduleCell | undefined): boolean {
  if (!cell) return false;
  return cell.firstHalf.kind === "pto" || cell.secondHalf.kind === "pto";
}

export function blockLabel(block: Block): string {
  return `${block.name} (${formatDate(block.startDate)}-${formatDate(block.endDate)})`;
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

export function describeCell(cell: ScheduleCell | undefined, rotations: Rotation[]): string {
  if (!cell || isEmptyCell(cell)) return "";

  const describeSegment = (segment: AssignmentSegment) => {
    if (segment.kind === "empty") return "Open";
    if (segment.kind === "pto") return "PTO";
    const rotationName = rotations.find((rotation) => rotation.id === segment.rotationId)?.name ?? segment.rotationId ?? "Rotation";
    return segment.rotationId === "elective" && segment.label?.trim() ? `${rotationName}: ${segment.label.trim()}` : rotationName;
  };

  if (
    cell.firstHalf.kind === cell.secondHalf.kind &&
    cell.firstHalf.rotationId === cell.secondHalf.rotationId
  ) {
    return describeSegment(cell.firstHalf);
  }

  return `H1: ${describeSegment(cell.firstHalf)} / H2: ${describeSegment(cell.secondHalf)}`;
}

export function rotationCreditsByBlock(state: AppState, blockId: string, rotationId: string): number {
  return state.residents.reduce((sum, resident) => {
    return sum + cellCredit(state.assignments[resident.id]?.[blockId], rotationId);
  }, 0);
}

export function assignmentFor(state: AppState, residentId: string, blockId: string): ScheduleCell {
  return state.assignments[residentId]?.[blockId] ?? emptyCell();
}

export function setFullAssignment(state: AppState, residentId: string, blockId: string, rotationId: string | ""): AppState {
  const next = cloneState(state);
  const resident = next.residents.find((item) => item.id === residentId);
  const pto = resident?.ptoByBlock[blockId] ?? "none";

  if (pto === "full") {
    next.assignments[residentId][blockId] = fullPtoCell();
    return next;
  }

  if (pto === "first-half") {
    next.assignments[residentId][blockId] = {
      firstHalf: ptoSegment,
      secondHalf: rotationId ? rotationSegment(rotationId) : emptySegment
    };
    return next;
  }

  if (pto === "second-half") {
    next.assignments[residentId][blockId] = {
      firstHalf: rotationId ? rotationSegment(rotationId) : emptySegment,
      secondHalf: ptoSegment
    };
    return next;
  }

  next.assignments[residentId][blockId] = rotationId ? fullRotationCell(rotationId) : emptyCell();
  return next;
}

export function setElectiveLabel(state: AppState, residentId: string, blockId: string, label: string): AppState {
  const next = cloneState(state);
  const cell = next.assignments[residentId]?.[blockId];
  if (!cell) return next;

  const applyLabel = (segment: AssignmentSegment): AssignmentSegment => {
    if (segment.kind !== "rotation" || segment.rotationId !== "elective") return normalizeSegment(segment);
    return rotationSegment("elective", label);
  };

  next.assignments[residentId][blockId] = {
    firstHalf: applyLabel(cell.firstHalf),
    secondHalf: applyLabel(cell.secondHalf)
  };
  return next;
}

export function getElectiveLabel(cell: ScheduleCell | undefined): string {
  if (!cell) return "";
  if (cell.firstHalf.kind === "rotation" && cell.firstHalf.rotationId === "elective") {
    return cell.firstHalf.label ?? "";
  }
  if (cell.secondHalf.kind === "rotation" && cell.secondHalf.rotationId === "elective") {
    return cell.secondHalf.label ?? "";
  }
  return "";
}

export function getSegmentRotation(cell: ScheduleCell | undefined): string {
  if (!cell) return "";
  if (
    cell.firstHalf.kind === "rotation" &&
    cell.secondHalf.kind === "rotation" &&
    cell.firstHalf.rotationId === cell.secondHalf.rotationId
  ) {
    return cell.firstHalf.rotationId ?? "";
  }

  const rotationSegmentValue =
    cell.firstHalf.kind === "rotation" ? cell.firstHalf : cell.secondHalf.kind === "rotation" ? cell.secondHalf : undefined;
  return rotationSegmentValue?.rotationId ?? "";
}

export function orderedBlocks(state: AppState): Block[] {
  return [...state.blocks].sort((a, b) => a.order - b.order);
}

export function rotationById(rotations: Rotation[], rotationId: string): Rotation | undefined {
  return rotations.find((rotation) => rotation.id === rotationId);
}
