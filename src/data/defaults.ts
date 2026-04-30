import type { AppState, AssignmentMatrix, Block, Requirements, Resident, Rotation } from "../types";
import { applyPtoToAssignments, createAssignmentMatrix } from "../lib/schedule";

const blockRows = [
  ["1A", "2026-07-01", "2026-07-12"],
  ["1B", "2026-07-13", "2026-07-26"],
  ["2A", "2026-07-27", "2026-08-09"],
  ["2B", "2026-08-10", "2026-08-23"],
  ["3A", "2026-08-24", "2026-09-06"],
  ["3B", "2026-09-07", "2026-09-20"],
  ["4A", "2026-09-21", "2026-10-04"],
  ["4B", "2026-10-05", "2026-10-18"],
  ["5A", "2026-10-19", "2026-11-01"],
  ["5B", "2026-11-02", "2026-11-15"],
  ["6A", "2026-11-16", "2026-11-29"],
  ["6B", "2026-11-30", "2026-12-13"],
  ["7A", "2026-12-14", "2026-12-27"],
  ["7B", "2026-12-28", "2027-01-10"],
  ["8A", "2027-01-11", "2027-01-24"],
  ["8B", "2027-01-25", "2027-02-07"],
  ["9A", "2027-02-08", "2027-02-21"],
  ["9B", "2027-02-22", "2027-03-07"],
  ["10A", "2027-03-08", "2027-03-21"],
  ["10B", "2027-03-22", "2027-04-04"],
  ["11A", "2027-04-05", "2027-04-18"],
  ["11B", "2027-04-19", "2027-05-02"],
  ["12A", "2027-05-03", "2027-05-16"],
  ["12B", "2027-05-17", "2027-05-30"],
  ["13A", "2027-05-31", "2027-06-13"],
  ["13B", "2027-06-14", "2027-06-30"]
] as const;

export const defaultBlocks: Block[] = blockRows.map(([name, startDate, endDate], index) => {
  const match = /^(\d+)([AB])$/.exec(name);
  if (!match) {
    throw new Error(`Invalid block name: ${name}`);
  }

  return {
    id: name.toLowerCase(),
    name,
    startDate,
    endDate,
    order: index,
    number: Number(match[1]),
    letter: match[2] as "A" | "B"
  };
});

export const defaultRotations: Rotation[] = [
  { id: "medicine", name: "Medicine", builtIn: true, minPerBlock: 1, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "nights", name: "Nights", builtIn: true, minPerBlock: 1, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "family-medicine", name: "Family Medicine", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: true },
  { id: "obgyn", name: "OBGYN", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "op-peds", name: "OP Peds", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "ss-peds", name: "SS Peds", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "ent", name: "ENT", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "rheum", name: "Rheum", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "icu", name: "ICU", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "pocus", name: "POCUS", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "msk", name: "MSK", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "geri", name: "Geri", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "ped-ed", name: "Ped ED", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "derm", name: "Derm", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false },
  { id: "elective", name: "Elective", builtIn: true, minPerBlock: 0, maxPerBlock: 20, canSplitWithHalfPto: false }
];

export const defaultRequirements: Requirements = {
  pgy2Medicine: 3,
  pgy2Nights: 3,
  pgy3Medicine: 3,
  pgy3Nights: 3,
  pgy2FamilyMedicine: 4,
  pgy3FamilyMedicine: 3,
  pgy2Elective: 3,
  pgy3Elective: 6
};

export function emptyPtoByBlock(blocks: Block[] = defaultBlocks) {
  return Object.fromEntries(blocks.map((block) => [block.id, "none" as const]));
}

export function createResident(name: string, pgyLevel: 2 | 3, isChief = false, blocks: Block[] = defaultBlocks): Resident {
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name,
    pgyLevel,
    isChief,
    ptoByBlock: emptyPtoByBlock(blocks)
  };
}

export function createDefaultState(residents: Resident[] = []): AppState {
  const assignments: AssignmentMatrix = createAssignmentMatrix(residents, defaultBlocks);
  return applyPtoToAssignments({
    residents,
    blocks: defaultBlocks,
    rotations: defaultRotations,
    requirements: defaultRequirements,
    assignments
  });
}

export function createDemoState(): AppState {
  const residents = [
    createResident("Avery Chen", 2),
    createResident("Jordan Malik", 2),
    createResident("Sam Rivera", 2),
    createResident("Riley Lawson", 2),
    createResident("Taylor Brooks", 3, true),
    createResident("Morgan Shah", 3),
    createResident("Casey Nguyen", 3),
    createResident("Drew Patel", 3)
  ];

  return createDefaultState(residents);
}
