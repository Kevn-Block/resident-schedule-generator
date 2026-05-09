import { describe, expect, it } from "vitest";
import { createDefaultState, createResident, defaultRotations } from "../data/defaults";
import type { AppState, Pgy1Type, PtoSelection, Resident } from "../types";
import { generateSchedule } from "./generator";
import { cellCredit, describeCell, fullRotationCell, hasFullBlockRotation, isFullPto, orderedBlocks } from "./schedule";
import { isSpreadDistanceAllowed } from "./rules";

function relaxedState(pgy1Type: Pgy1Type = "ty"): AppState {
  return {
    ...createDefaultState([createResident("Intern One", pgy1Type)]),
    rotations: defaultRotations.map((rotation) => ({ ...rotation, minPerBlock: 0 }))
  };
}

function blockId(state: AppState, name: string) {
  return state.blocks.find((block) => block.name === name)!.id;
}

function setProtectedBlock(state: AppState, residentIndex: number, blockName: string, selection: PtoSelection) {
  const resident = state.residents[residentIndex];
  resident.ptoByBlock[blockId(state, blockName)] = selection;
}

function importedPtoPatternState() {
  const residents = [
    ...["Anthony", "Irene", "Paige", "Joy", "Jared"].map((name) => createResident(name, "fm")),
    ...["Suraj", "Elyssa", "Gregory", "Sofia", "Spencer", "Bo Song", "Jonathan", "Nick", "Afaaq", "Kenneth", "Kian", "Juliette"].map(
      (name) => createResident(name, "ty")
    )
  ];
  const state = createDefaultState(residents);

  const selections: Array<[number, string, PtoSelection]> = [
    [0, "3B", "first-half"],
    [0, "7A", "second-half"],
    [0, "12A", "full"],
    [1, "5B", "second-half"],
    [1, "9A", "first-half"],
    [1, "11B", "full"],
    [2, "2B", "first-half"],
    [2, "7B", "second-half"],
    [2, "12B", "full"],
    [3, "4A", "first-half"],
    [3, "7A", "second-half"],
    [3, "8A", "full"],
    [4, "6A", "full"],
    [4, "11B", "full"],
    [5, "3A", "elective"],
    [5, "3B", "elective"],
    [5, "7A", "full"],
    [5, "7B", "full"],
    [6, "7B", "full"],
    [6, "10B", "full"],
    [7, "7B", "full"],
    [7, "12B", "full"],
    [8, "3B", "elective"],
    [8, "4A", "elective"],
    [8, "7B", "full"],
    [8, "11A", "full"],
    [9, "2B", "elective"],
    [9, "3A", "elective"],
    [9, "8A", "full"],
    [9, "10B", "full"],
    [10, "7A", "full"],
    [10, "12B", "full"],
    [11, "5A", "full"],
    [11, "10A", "full"],
    [13, "10A", "full"],
    [13, "12B", "full"],
    [14, "4A", "full"],
    [14, "10B", "full"],
    [15, "7B", "full"],
    [15, "11B", "full"],
    [16, "5B", "full"],
    [16, "11A", "full"]
  ];

  for (const [residentIndex, blockName, selection] of selections) {
    setProtectedBlock(state, residentIndex, blockName, selection);
  }

  state.assignments[state.residents[5].id][blockId(state, "3A")] = fullRotationCell("elective", "Anesthesia");
  state.assignments[state.residents[5].id][blockId(state, "3B")] = fullRotationCell("elective", "Anesthesia");

  return state;
}

function rotationCreditForResident(state: AppState, resident: Resident, rotationId: string) {
  return orderedBlocks(state).reduce((sum, block) => sum + cellCredit(state.assignments[resident.id][block.id], rotationId), 0);
}

function fullRotationBlockIndexes(state: AppState, resident: Resident, rotationId: string) {
  return orderedBlocks(state)
    .map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => hasFullBlockRotation(state.assignments[resident.id][block.id], rotationId))
    .map(({ blockIndex }) => blockIndex);
}

function fullRotationRuns(state: AppState, resident: Resident, rotationId: string) {
  const blockIndexes = fullRotationBlockIndexes(state, resident, rotationId);
  const runs: Array<{ start: number; end: number; length: number }> = [];
  let start = blockIndexes[0];
  let end = blockIndexes[0];

  for (let index = 1; index < blockIndexes.length; index += 1) {
    const blockIndex = blockIndexes[index];
    if (blockIndex === end + 1) {
      end = blockIndex;
    } else {
      runs.push({ start, end, length: end - start + 1 });
      start = blockIndex;
      end = blockIndex;
    }
  }

  if (blockIndexes.length > 0) {
    runs.push({ start, end, length: end - start + 1 });
  }

  return runs;
}

function expectSpreadDistances(blockIndexes: number[]) {
  for (let index = 0; index < blockIndexes.length - 1; index += 1) {
    expect(isSpreadDistanceAllowed(blockIndexes[index + 1] - blockIndexes[index])).toBe(true);
  }
}

function expectMedicineChunksSpread(state: AppState, resident: Resident) {
  const runs = fullRotationRuns(state, resident, "medicine");
  const expectedLengths = resident.pgy1Type === "fm" ? [1, 2, 2] : [2, 2, 2];

  expect(runs.map((run) => run.length).sort((first, second) => first - second)).toEqual(expectedLengths);

  for (let index = 0; index < runs.length - 1; index += 1) {
    expect(isSpreadDistanceAllowed(runs[index + 1].start - runs[index].end)).toBe(true);
  }
}

describe("generateSchedule", () => {
  it("returns a generation diagnostic without partial changes when coverage is impossible", () => {
    const state = relaxedState();
    const result = generateSchedule(state);

    expect(result.success).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "generation.no-solution")).toBe(true);
    expect(describeCell(result.state.assignments[state.residents[0].id][blockId(state, "1A")], state.rotations)).toBe("");
  });

  it("generates Medicine and Nights for the imported PTO pattern", () => {
    const state = importedPtoPatternState();

    const result = generateSchedule(state);

    expect(result.success).toBe(true);
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "generation.no-solution")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "rule.days-nights-adjacency")).toBe(false);

    for (const block of orderedBlocks(result.state)) {
      const medicineCredit = result.state.residents.reduce(
        (sum, resident) => sum + cellCredit(result.state.assignments[resident.id][block.id], "medicine"),
        0
      );
      const nightsCredit = result.state.residents.reduce(
        (sum, resident) => sum + cellCredit(result.state.assignments[resident.id][block.id], "nights"),
        0
      );

      expect(medicineCredit).toBeGreaterThanOrEqual(3);
      expect(medicineCredit).toBeLessThanOrEqual(4);
      expect(nightsCredit).toBeGreaterThanOrEqual(2);
      expect(nightsCredit).toBeLessThanOrEqual(3);
    }

    for (const resident of result.state.residents) {
      expect(rotationCreditForResident(result.state, resident, "medicine")).toBe(resident.pgy1Type === "fm" ? 5 : 6);
      expect(rotationCreditForResident(result.state, resident, "nights")).toBe(resident.pgy1Type === "fm" ? 3 : 4);
      expectSpreadDistances(fullRotationBlockIndexes(result.state, resident, "nights"));
      expectMedicineChunksSpread(result.state, resident);
    }

    const anthony = result.state.residents.find((resident) => resident.name === "Anthony")!;
    expectSpreadDistances(fullRotationBlockIndexes(result.state, anthony, "nights"));

    const fmOnlyAssignments = [
      { rotationId: "medicine", blockName: "13A", min: 3 },
      { rotationId: "medicine", blockName: "13B", min: 3 },
      { rotationId: "nights", blockName: "13B", min: 2 }
    ];

    for (const { rotationId, blockName, min } of fmOnlyAssignments) {
      const restrictedBlockId = blockId(result.state, blockName);
      const fmCredit = result.state.residents
        .filter((resident) => resident.pgy1Type === "fm")
        .reduce((sum, resident) => sum + cellCredit(result.state.assignments[resident.id][restrictedBlockId], rotationId), 0);
      const nonFmCredit = result.state.residents
        .filter((resident) => resident.pgy1Type !== "fm")
        .reduce((sum, resident) => sum + cellCredit(result.state.assignments[resident.id][restrictedBlockId], rotationId), 0);

      expect(fmCredit).toBeGreaterThanOrEqual(min);
      expect(nonFmCredit).toBe(0);
    }
  });

  it("preserves protected cells and existing non-Medicine/Nights assignments", () => {
    const state = importedPtoPatternState();
    const manualResident = state.residents[12];
    state.assignments[manualResident.id][blockId(state, "13B")] = fullRotationCell("icu");

    const result = generateSchedule(state);

    expect(result.success).toBe(true);
    expect(describeCell(result.state.assignments[result.state.residents[0].id][blockId(result.state, "3B")], result.state.rotations)).toBe(
      "H1: PTO / H2: FM Clinic"
    );
    expect(describeCell(result.state.assignments[result.state.residents[5].id][blockId(result.state, "3A")], result.state.rotations)).toBe(
      "Elective: Anesthesia"
    );
    expect(describeCell(result.state.assignments[manualResident.id][blockId(result.state, "13B")], result.state.rotations)).toBe("ICU");
  });

  it("syncs protected PTO and PTO Elective selections", () => {
    const state = relaxedState();
    const resident = state.residents[0];
    const block1A = blockId(state, "1A");
    const block1B = blockId(state, "1B");
    resident.ptoByBlock[block1A] = "full";
    resident.ptoByBlock[block1B] = "elective";
    state.assignments[resident.id][block1A] = fullRotationCell("medicine");
    state.assignments[resident.id][block1B] = fullRotationCell("elective", "Research");

    const result = generateSchedule(state);

    expect(isFullPto(result.state.assignments[resident.id][block1A])).toBe(true);
    expect(hasFullBlockRotation(result.state.assignments[resident.id][block1B], "elective")).toBe(true);
    expect(describeCell(result.state.assignments[resident.id][block1B], result.state.rotations)).toBe("Elective: Research");
  });

  it("converts TY half PTO selections to full-block PTO during generation", () => {
    const state = relaxedState();
    const resident = state.residents[0];
    const block1A = blockId(state, "1A");
    resident.ptoByBlock[block1A] = "first-half";

    const result = generateSchedule(state);

    expect(result.state.residents[0].ptoByBlock[block1A]).toBe("full");
    expect(isFullPto(result.state.assignments[resident.id][block1A])).toBe(true);
  });

  it("pairs FM half PTO with FM Clinic during generation", () => {
    const state = relaxedState("fm");
    const resident = state.residents[0];
    const block1A = blockId(state, "1A");
    resident.ptoByBlock[block1A] = "first-half";
    state.assignments[resident.id][block1A] = fullRotationCell("medicine");

    const result = generateSchedule(state);

    expect(describeCell(result.state.assignments[resident.id][block1A], result.state.rotations)).toBe("H1: PTO / H2: FM Clinic");
  });
});
