import { describe, expect, it } from "vitest";
import { defaultBlocks, defaultRequirements, defaultRotations, emptyPtoByBlock } from "../data/defaults";
import type { AppState, Resident } from "../types";
import { createAssignmentMatrix, describeCell, fullRotationCell, ptoCell, setElectiveLabel, setFullAssignment } from "./schedule";
import { hasErrors, validateSchedule } from "./validation";

function resident(id: string, pgyLevel: 2 | 3, isChief = false): Resident {
  return {
    id,
    name: id,
    pgyLevel,
    isChief,
    ptoByBlock: emptyPtoByBlock(defaultBlocks)
  };
}

function stateWith(residents: Resident[]): AppState {
  return {
    residents,
    blocks: defaultBlocks,
    rotations: defaultRotations,
    requirements: defaultRequirements,
    assignments: createAssignmentMatrix(residents, defaultBlocks)
  };
}

function blockId(name: string) {
  return defaultBlocks.find((block) => block.name === name)!.id;
}

describe("validateSchedule", () => {
  it("requires Medicine and Nights coverage every block", () => {
    const state = stateWith([resident("pgy2", 2), resident("pgy3", 3)]);
    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "coverage.missing-days")).toBe(true);
    expect(diagnostics.some((item) => item.code === "coverage.missing-nights")).toBe(true);
  });

  it("counts half-block Family Medicine as 0.5 when split with half PTO", () => {
    const pgy2 = resident("pgy2", 2);
    pgy2.ptoByBlock[blockId("1A")] = "first-half";
    const state = stateWith([pgy2]);
    state.requirements = { ...state.requirements, pgy2FamilyMedicine: 0.5 };
    state.assignments[pgy2.id][blockId("1A")] = {
      ...ptoCell("first-half"),
      secondHalf: { kind: "rotation", rotationId: "family-medicine" }
    };

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "pgy2.family-medicine.total")).toBe(false);
  });

  it("rejects PTO splits with rotations that are not split eligible", () => {
    const pgy2 = resident("pgy2", 2);
    pgy2.ptoByBlock[blockId("1A")] = "first-half";
    const state = stateWith([pgy2]);
    state.assignments[pgy2.id][blockId("1A")] = {
      ...ptoCell("first-half"),
      secondHalf: { kind: "rotation", rotationId: "medicine" }
    };

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "pto.split-ineligible")).toBe(true);
  });

  it("warns when a consecutive pair crosses block numbers", () => {
    const pgy2 = resident("pgy2", 2);
    const state = stateWith([pgy2]);
    state.assignments[pgy2.id][blockId("3B")] = fullRotationCell("obgyn");
    state.assignments[pgy2.id][blockId("4A")] = fullRotationCell("obgyn");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "preference.cross-number-pair")).toBe(true);
    expect(diagnostics.some((item) => item.code === "resident.consecutive-missing" && item.rotationId === "obgyn")).toBe(false);
  });

  it("requires PGY2 POCUS", () => {
    const pgy2 = resident("pgy2", 2);
    const state = stateWith([pgy2]);

    const missingDiagnostics = validateSchedule(state);
    expect(missingDiagnostics.some((item) => item.code === "pgy2.pocus.missing")).toBe(true);

    state.assignments[pgy2.id][blockId("2A")] = fullRotationCell("pocus");
    const satisfiedDiagnostics = validateSchedule(state);
    expect(satisfiedDiagnostics.some((item) => item.code === "pgy2.pocus.missing")).toBe(false);
  });

  it("does not warn when PGY2 POCUS immediately follows ICU", () => {
    const pgy2 = resident("pgy2", 2);
    const state = stateWith([pgy2]);
    state.assignments[pgy2.id][blockId("2A")] = fullRotationCell("icu");
    state.assignments[pgy2.id][blockId("2B")] = fullRotationCell("pocus");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "preference.pocus-after-icu")).toBe(false);
  });

  it("warns but does not fail when PGY2 POCUS is not immediately after ICU", () => {
    const pgy2 = resident("pgy2", 2);
    const state = stateWith([pgy2]);
    state.assignments[pgy2.id][blockId("2A")] = fullRotationCell("icu");
    state.assignments[pgy2.id][blockId("3A")] = fullRotationCell("pocus");

    const diagnostics = validateSchedule(state);
    const pocusPreference = diagnostics.find((item) => item.code === "preference.pocus-after-icu");

    expect(pocusPreference?.severity).toBe("warning");
  });

  it("requires PGY3 Ped ED as two consecutive full blocks", () => {
    const pgy3 = resident("pgy3", 3);
    const state = stateWith([pgy3]);
    state.assignments[pgy3.id][blockId("3A")] = fullRotationCell("ped-ed");
    state.assignments[pgy3.id][blockId("4A")] = fullRotationCell("ped-ed");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "resident.consecutive-missing" && item.rotationId === "ped-ed")).toBe(true);
  });

  it("warns when a PGY3 Ped ED pair crosses block numbers", () => {
    const pgy3 = resident("pgy3", 3);
    const state = stateWith([pgy3]);
    state.assignments[pgy3.id][blockId("3B")] = fullRotationCell("ped-ed");
    state.assignments[pgy3.id][blockId("4A")] = fullRotationCell("ped-ed");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "preference.cross-number-pair" && item.rotationId === "ped-ed")).toBe(true);
    expect(diagnostics.some((item) => item.code === "resident.consecutive-missing" && item.rotationId === "ped-ed")).toBe(false);
  });

  it("requires PGY3 Derm", () => {
    const pgy3 = resident("pgy3", 3);
    const state = stateWith([pgy3]);

    const missingDiagnostics = validateSchedule(state);
    expect(missingDiagnostics.some((item) => item.code === "pgy3.derm.missing")).toBe(true);

    state.assignments[pgy3.id][blockId("2A")] = fullRotationCell("derm");
    const satisfiedDiagnostics = validateSchedule(state);
    expect(satisfiedDiagnostics.some((item) => item.code === "pgy3.derm.missing")).toBe(false);
  });

  it("enforces PGY2 first Medicine and Nights pairing with PGY3", () => {
    const pgy2 = resident("pgy2", 2);
    const pgy3 = resident("pgy3", 3);
    const state = stateWith([pgy2, pgy3]);
    state.assignments[pgy2.id][blockId("1A")] = fullRotationCell("medicine");
    state.assignments[pgy2.id][blockId("1B")] = fullRotationCell("nights");
    state.assignments[pgy3.id][blockId("1A")] = fullRotationCell("medicine");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "pgy2.first-medicine-pairing")).toBe(false);
    expect(diagnostics.some((item) => item.code === "pgy2.first-nights-pairing")).toBe(true);
  });

  it("warns when a PGY3 has no early Medicine/Nights PGY2 pair", () => {
    const pgy2 = resident("pgy2", 2);
    const pgy3 = resident("pgy3", 3);
    const state = stateWith([pgy2, pgy3]);
    state.assignments[pgy3.id][blockId("1A")] = fullRotationCell("medicine");

    const diagnostics = validateSchedule(state);
    const warning = diagnostics.find((item) => item.code === "preference.pgy3-early-pairing" && item.residentId === pgy3.id);

    expect(warning?.severity).toBe("warning");
    expect(hasErrors(diagnostics.filter((item) => item.code === "preference.pgy3-early-pairing"))).toBe(false);
  });

  it("does not warn when a PGY3 has a same-block same-rotation PGY2 early pair", () => {
    const pgy2 = resident("pgy2", 2);
    const pgy3 = resident("pgy3", 3);
    const state = stateWith([pgy2, pgy3]);
    state.assignments[pgy2.id][blockId("1A")] = fullRotationCell("medicine");
    state.assignments[pgy3.id][blockId("1A")] = fullRotationCell("medicine");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "preference.pgy3-early-pairing" && item.residentId === pgy3.id)).toBe(false);
  });

  it("warns when residents exceed 3 early Medicine/Nights block-equivalents", () => {
    const pgy2 = resident("pgy2", 2);
    const pgy3 = resident("pgy3", 3);
    const state = stateWith([pgy2, pgy3]);

    for (const [blockName, rotationId] of [
      ["1A", "medicine"],
      ["1B", "nights"],
      ["2A", "medicine"],
      ["2B", "nights"]
    ] as const) {
      state.assignments[pgy2.id][blockId(blockName)] = fullRotationCell(rotationId);
      state.assignments[pgy3.id][blockId(blockName)] = fullRotationCell(rotationId);
    }

    const diagnostics = validateSchedule(state);
    const loadWarnings = diagnostics.filter((item) => item.code === "preference.early-med-nights-load");

    expect(loadWarnings).toHaveLength(2);
    expect(loadWarnings.every((item) => item.severity === "warning")).toBe(true);
    expect(hasErrors(loadWarnings)).toBe(false);
  });

  it("does not warn when residents have exactly 3 early Medicine/Nights block-equivalents", () => {
    const pgy2 = resident("pgy2", 2);
    const pgy3 = resident("pgy3", 3);
    const state = stateWith([pgy2, pgy3]);

    for (const [blockName, rotationId] of [
      ["1A", "medicine"],
      ["1B", "nights"],
      ["2A", "medicine"]
    ] as const) {
      state.assignments[pgy2.id][blockId(blockName)] = fullRotationCell(rotationId);
      state.assignments[pgy3.id][blockId(blockName)] = fullRotationCell(rotationId);
    }

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "preference.early-med-nights-load")).toBe(false);
  });

  it.each([
    ["medicine", "resident.too-many-medicine"],
    ["nights", "resident.too-many-nights"]
  ] as const)("fails when a resident has more than 3 %s blocks", (rotationId, code) => {
    const pgy2 = resident("pgy2", 2);
    const state = stateWith([pgy2]);

    for (const blockName of ["1A", "3A", "5A", "7A"]) {
      state.assignments[pgy2.id][blockId(blockName)] = fullRotationCell(rotationId);
    }

    const diagnostics = validateSchedule(state);
    const capDiagnostic = diagnostics.find((item) => item.code === code);

    expect(capDiagnostic?.severity).toBe("error");
  });

  it.each([
    ["medicine", "resident.too-many-medicine"],
    ["nights", "resident.too-many-nights"]
  ] as const)("allows exactly 3 %s blocks", (rotationId, code) => {
    const pgy2 = resident("pgy2", 2);
    const state = stateWith([pgy2]);

    for (const blockName of ["1A", "3A", "5A"]) {
      state.assignments[pgy2.id][blockId(blockName)] = fullRotationCell(rotationId);
    }

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === code)).toBe(false);
  });

  it("counts labeled electives as Elective and displays the label", () => {
    const pgy2 = resident("pgy2", 2);
    const state = stateWith([pgy2]);
    state.requirements = { ...state.requirements, pgy2Elective: 1 };
    state.assignments[pgy2.id][blockId("1A")] = fullRotationCell("elective", "Research");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "pgy2.elective.total")).toBe(false);
    expect(describeCell(state.assignments[pgy2.id][blockId("1A")], state.rotations)).toBe("Elective: Research");
  });

  it("drops elective labels when changing away from Elective", () => {
    const pgy2 = resident("pgy2", 2);
    let state = stateWith([pgy2]);
    state = setFullAssignment(state, pgy2.id, blockId("1A"), "elective");
    state = setElectiveLabel(state, pgy2.id, blockId("1A"), "Research");
    state = setFullAssignment(state, pgy2.id, blockId("1A"), "medicine");

    expect(describeCell(state.assignments[pgy2.id][blockId("1A")], state.rotations)).toBe("Medicine");
  });

  it.each([
    ["medicine", "medicine", "resident.back-to-back-medicine"],
    ["medicine", "nights", "resident.medicine-to-nights"],
    ["nights", "medicine", "resident.nights-to-medicine"],
    ["nights", "nights", "resident.back-to-back-nights"]
  ] as const)("fails when %s and %s are adjacent", (currentRotation, nextRotation, code) => {
    const pgy2 = resident("pgy2", 2);
    const state = stateWith([pgy2]);
    state.assignments[pgy2.id][blockId("1A")] = fullRotationCell(currentRotation);
    state.assignments[pgy2.id][blockId("1B")] = fullRotationCell(nextRotation);

    const diagnostics = validateSchedule(state);
    const backToBackDiagnostics = diagnostics.filter((item) => item.code === code);

    expect(backToBackDiagnostics).toHaveLength(1);
    expect(backToBackDiagnostics[0].severity).toBe("error");
    expect(hasErrors(backToBackDiagnostics)).toBe(true);
  });
});
