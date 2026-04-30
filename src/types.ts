export type PgyLevel = 2 | 3;

export type PtoSelection = "none" | "full" | "first-half" | "second-half";

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
  pgyLevel: PgyLevel;
  isChief: boolean;
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

export interface Requirements {
  pgy2Medicine: number;
  pgy2Nights: number;
  pgy3Medicine: number;
  pgy3Nights: number;
  pgy2FamilyMedicine: number;
  pgy3FamilyMedicine: number;
  pgy2Elective: number;
  pgy3Elective: number;
}

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
  requirements: Requirements;
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
  "family-medicine",
  "obgyn",
  "op-peds",
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
