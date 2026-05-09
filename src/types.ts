export type PtoSelection = "none" | "full" | "first-half" | "second-half" | "elective";

export type Pgy1Type = "ty" | "fm";

export const PGY1_TYPE_LABELS: Record<Pgy1Type, string> = {
  ty: "TY",
  fm: "FM"
};

export type SegmentKind = "empty" | "rotation" | "pto";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Block {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  order: number;
  number: number;
  letter: "A" | "B";
}

export interface Resident {
  id: string;
  name: string;
  pgy1Type: Pgy1Type;
  isChief: boolean;
  isMatched: boolean;
  matchedDetails: string;
  isUnmatched: boolean;
  unmatchedDetails: string;
  ptoByBlock: Record<string, PtoSelection>;
}

export interface Rotation {
  id: string;
  name: string;
  builtIn: boolean;
  minPerBlock: number;
  maxPerBlock: number;
  canSplitWithHalfPto: boolean;
}

export interface AssignmentSegment {
  kind: SegmentKind;
  rotationId?: string;
  label?: string;
}

export interface ScheduleCell {
  firstHalf: AssignmentSegment;
  secondHalf: AssignmentSegment;
}

export type AssignmentMatrix = Record<string, Record<string, ScheduleCell>>;

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  residentId?: string;
  blockId?: string;
  rotationId?: string;
}

export interface AppState {
  residents: Resident[];
  blocks: Block[];
  rotations: Rotation[];
  assignments: AssignmentMatrix;
}

export interface GenerationResult {
  state: AppState;
  diagnostics: Diagnostic[];
  success: boolean;
}

export const BUILT_IN_ROTATION_IDS = [
  "medicine",
  "nights",
  "em",
  "op-peds",
  "psych",
  "surgery",
  "endo",
  "uro",
  "cardio",
  "family-medicine",
  "obgyn",
  "ss-peds",
  "ent",
  "rheum",
  "icu",
  "pocus",
  "msk",
  "geri",
  "ped-ed",
  "derm",
  "elective"
] as const;

export type BuiltInRotationId = (typeof BUILT_IN_ROTATION_IDS)[number];
