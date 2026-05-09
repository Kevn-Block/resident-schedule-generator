import { describe, expect, it } from "vitest";
import { defaultBlocks, defaultRotations, emptyPtoByBlock } from "../data/defaults";
import type { AppState, Pgy1Type, Resident, Rotation } from "../types";
import { createAssignmentMatrix, describeCell, fullRotationCell, ptoCell, setElectiveLabel, setFullAssignment } from "./schedule";
import { hasErrors, validateSchedule } from "./validation";

function resident(id: string, isChief = false, pgy1Type: Pgy1Type = "ty"): Resident {
  return {
    id,
    name: id,
    pgy1Type,
    isChief,
    isMatched: false,
    matchedDetails: "",
    isUnmatched: false,
    unmatchedDetails: "",
    ptoByBlock: emptyPtoByBlock(defaultBlocks)
  };
}

function relaxedRotations(): Rotation[] {
  return defaultRotations.map((rotation) => ({ ...rotation, minPerBlock: 0 }));
}

function stateWith(residents: Resident[], rotations: Rotation[] = relaxedRotations()): AppState {
  return {
    residents,
    blocks: defaultBlocks,
    rotations,
    assignments: createAssignmentMatrix(residents, defaultBlocks)
  };
}

function blockId(name: string) {
  return defaultBlocks.find((block) => block.name === name)!.id;
}

function assignFullBlocks(state: AppState, residentId: string, rotationId: string, blockNames: string[]) {
  for (const blockName of blockNames) {
    state.assignments[residentId][blockId(blockName)] = fullRotationCell(rotationId);
  }
}

describe("validateSchedule", () => {
  it("requires at least one resident", () => {
    const diagnostics = validateSchedule(stateWith([]));

    expect(diagnostics.some((item) => item.code === "setup.no-residents")).toBe(true);
  });

  it("requires resident names", () => {
    const intern = resident("intern");
    intern.name = " ";
    const diagnostics = validateSchedule(stateWith([intern]));

    expect(diagnostics.some((item) => item.code === "resident.name-missing")).toBe(true);
  });

  it("does not enforce removed coverage, chief, or adjacency constraints", () => {
    const state = stateWith([resident("chief", true)]);
    assignFullBlocks(state, "chief", "medicine", ["1A", "1B", "3A", "3B", "5A", "5B"]);
    assignFullBlocks(state, "chief", "nights", ["6A", "7A", "8A", "9A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code.startsWith("coverage."))).toBe(false);
    expect(diagnostics.some((item) => item.code.startsWith("chief."))).toBe(false);
    expect(diagnostics.some((item) => item.code.startsWith(["p", "g", "y"].join("")))).toBe(false);
    expect(diagnostics.some((item) => item.code.startsWith("resident.back-to-back"))).toBe(false);
    expect(diagnostics.some((item) => item.code === "resident.nights-to-medicine")).toBe(false);
  });

  it("does not require any default rotation capacity assignments", () => {
    const diagnostics = validateSchedule(stateWith([resident("intern")], defaultRotations));

    expect(diagnostics.some((item) => item.code === "capacity.min")).toBe(false);
  });

  it("requires each block to have at least 3 PGY1 on Days and 2 PGY1 on Nights", () => {
    const diagnostics = validateSchedule(stateWith([resident("intern")]));

    expect(diagnostics.some((item) => item.code === "block.days.min" && item.blockId === blockId("1A"))).toBe(true);
    expect(diagnostics.some((item) => item.code === "block.nights.min" && item.blockId === blockId("1A"))).toBe(true);
  });

  it("limits each block to at most 4 PGY1 on Days and 3 PGY1 on Nights", () => {
    const residents = Array.from({ length: 9 }, (_, index) => resident(`intern-${index + 1}`));
    const state = stateWith(residents);
    assignFullBlocks(state, residents[0].id, "medicine", ["1A"]);
    assignFullBlocks(state, residents[1].id, "medicine", ["1A"]);
    assignFullBlocks(state, residents[2].id, "medicine", ["1A"]);
    assignFullBlocks(state, residents[3].id, "medicine", ["1A"]);
    assignFullBlocks(state, residents[4].id, "medicine", ["1A"]);
    assignFullBlocks(state, residents[5].id, "nights", ["1A"]);
    assignFullBlocks(state, residents[6].id, "nights", ["1A"]);
    assignFullBlocks(state, residents[7].id, "nights", ["1A"]);
    assignFullBlocks(state, residents[8].id, "nights", ["1A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "block.days.max" && item.blockId === blockId("1A"))).toBe(true);
    expect(diagnostics.some((item) => item.code === "block.nights.max" && item.blockId === blockId("1A"))).toBe(true);
  });

  it("warns when more than 1 FM is on the same block for Days or Nights", () => {
    const residents = [
      resident("fm-1", false, "fm"),
      resident("fm-2", false, "fm"),
      resident("ty-1", false, "ty"),
      resident("fm-3", false, "fm"),
      resident("fm-4", false, "fm")
    ];
    const state = stateWith(residents);
    assignFullBlocks(state, residents[0].id, "medicine", ["1A"]);
    assignFullBlocks(state, residents[1].id, "medicine", ["1A"]);
    assignFullBlocks(state, residents[2].id, "medicine", ["1A"]);
    assignFullBlocks(state, residents[3].id, "nights", ["1A"]);
    assignFullBlocks(state, residents[4].id, "nights", ["1A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.find((item) => item.code === "preference.fm-days-balance")?.severity).toBe("warning");
    expect(diagnostics.find((item) => item.code === "preference.fm-nights-balance")?.severity).toBe("warning");
  });

  it("rejects non-FM residents on FM-only late Medicine and Nights blocks", () => {
    const residents = [resident("ty-medicine", false, "ty"), resident("ty-nights", false, "ty")];
    const state = stateWith(residents);
    assignFullBlocks(state, residents[0].id, "medicine", ["13A", "13B"]);
    assignFullBlocks(state, residents[1].id, "nights", ["13B"]);

    const diagnostics = validateSchedule(state);

    expect(
      diagnostics.some((item) => item.code === "rule.fm-only-medicine" && item.blockId === blockId("13A"))
    ).toBe(true);
    expect(
      diagnostics.some((item) => item.code === "rule.fm-only-medicine" && item.blockId === blockId("13B"))
    ).toBe(true);
    expect(
      diagnostics.some((item) => item.code === "rule.fm-only-nights" && item.blockId === blockId("13B"))
    ).toBe(true);
  });

  it("allows FM residents on FM-only late blocks without FM-balance warnings", () => {
    const residents = [
      resident("fm-medicine-1", false, "fm"),
      resident("fm-medicine-2", false, "fm"),
      resident("fm-nights-1", false, "fm"),
      resident("fm-nights-2", false, "fm")
    ];
    const state = stateWith(residents);
    assignFullBlocks(state, residents[0].id, "medicine", ["13A", "13B"]);
    assignFullBlocks(state, residents[1].id, "medicine", ["13A", "13B"]);
    assignFullBlocks(state, residents[2].id, "nights", ["13B"]);
    assignFullBlocks(state, residents[3].id, "nights", ["13B"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code.startsWith("rule.fm-only"))).toBe(false);
    expect(
      diagnostics.some(
        (item) =>
          item.code === "preference.fm-days-balance" &&
          (item.blockId === blockId("13A") || item.blockId === blockId("13B"))
      )
    ).toBe(false);
    expect(
      diagnostics.some((item) => item.code === "preference.fm-nights-balance" && item.blockId === blockId("13B"))
    ).toBe(false);
  });

  it("warns when extra Days or Nights coverage appears after an earlier block is at minimum", () => {
    const residents = Array.from({ length: 7 }, (_, index) => resident(`intern-${index + 1}`));
    const state = stateWith(residents);
    assignFullBlocks(state, residents[0].id, "medicine", ["1A", "1B"]);
    assignFullBlocks(state, residents[1].id, "medicine", ["1A", "1B"]);
    assignFullBlocks(state, residents[2].id, "medicine", ["1A", "1B"]);
    assignFullBlocks(state, residents[3].id, "medicine", ["1B"]);
    assignFullBlocks(state, residents[4].id, "nights", ["1A", "1B"]);
    assignFullBlocks(state, residents[5].id, "nights", ["1A", "1B"]);
    assignFullBlocks(state, residents[6].id, "nights", ["1B"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.find((item) => item.code === "preference.early-extra-days")?.severity).toBe("warning");
    expect(diagnostics.find((item) => item.code === "preference.early-extra-nights")?.severity).toBe("warning");
  });

  it("requires FM residents to complete 5 Medicine blocks and 3 Nights blocks", () => {
    const diagnostics = validateSchedule(stateWith([resident("fm-intern", false, "fm")]));

    expect(diagnostics.some((item) => item.code === "fm.medicine.total")).toBe(true);
    expect(diagnostics.some((item) => item.code === "fm.medicine.distribution")).toBe(true);
    expect(diagnostics.some((item) => item.code === "fm.nights.total")).toBe(true);
  });

  it("accepts FM Medicine as two 2-block chunks plus one single block with 3 Nights blocks", () => {
    const fm = resident("fm-intern", false, "fm");
    const state = stateWith([fm]);
    assignFullBlocks(state, fm.id, "medicine", ["1A", "1B", "3B", "4A", "6A"]);
    assignFullBlocks(state, fm.id, "nights", ["2A", "4B", "7A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code.startsWith("fm."))).toBe(false);
    expect(diagnostics.some((item) => item.code === "rule.medicine-spacing")).toBe(false);
    expect(diagnostics.some((item) => item.code === "rule.nights-spacing")).toBe(false);
  });

  it("warns but does not fail when FM has adjacent Days and Nights", () => {
    const fm = resident("fm-intern", false, "fm");
    const state = stateWith([fm]);
    assignFullBlocks(state, fm.id, "medicine", ["1A", "1B", "3B", "4A", "6A"]);
    assignFullBlocks(state, fm.id, "nights", ["2A", "4B", "6B"]);

    const diagnostics = validateSchedule(state);
    const warning = diagnostics.find((item) => item.code === "preference.days-nights-adjacency");

    expect(diagnostics.some((item) => item.code.startsWith("fm."))).toBe(false);
    expect(diagnostics.some((item) => item.code.startsWith("rule."))).toBe(false);
    expect(warning?.severity).toBe("warning");
  });

  it("rejects FM Medicine blocks that are not distributed as 2, 2, and 1", () => {
    const fm = resident("fm-intern", false, "fm");
    const state = stateWith([fm]);
    assignFullBlocks(state, fm.id, "medicine", ["1A", "1B", "2A", "3A", "3B"]);
    assignFullBlocks(state, fm.id, "nights", ["6A", "7A", "8A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "fm.medicine.total")).toBe(false);
    expect(diagnostics.some((item) => item.code === "fm.medicine.distribution")).toBe(true);
    expect(diagnostics.some((item) => item.code === "fm.nights.total")).toBe(false);
  });

  it("requires TY residents to complete 6 Medicine blocks and 4 Nights blocks", () => {
    const diagnostics = validateSchedule(stateWith([resident("ty-intern", false, "ty")]));

    expect(diagnostics.some((item) => item.code === "ty.medicine.total")).toBe(true);
    expect(diagnostics.some((item) => item.code === "ty.medicine.distribution")).toBe(true);
    expect(diagnostics.some((item) => item.code === "ty.nights.total")).toBe(true);
    expect(diagnostics.some((item) => item.code.startsWith("fm."))).toBe(false);
  });

  it("accepts TY Medicine as three 2-block chunks with 4 Nights blocks", () => {
    const ty = resident("ty-intern", false, "ty");
    const state = stateWith([ty]);
    assignFullBlocks(state, ty.id, "medicine", ["1A", "1B", "3B", "4A", "6A", "6B"]);
    assignFullBlocks(state, ty.id, "nights", ["2A", "4B", "7A", "9A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code.startsWith("ty."))).toBe(false);
    expect(diagnostics.some((item) => item.code === "rule.medicine-spacing")).toBe(false);
    expect(diagnostics.some((item) => item.code === "rule.nights-spacing")).toBe(false);
  });

  it("warns but does not fail when TY has adjacent Days and Nights", () => {
    const ty = resident("ty-intern", false, "ty");
    const state = stateWith([ty]);
    assignFullBlocks(state, ty.id, "medicine", ["1A", "1B", "3B", "4A", "6A", "6B"]);
    assignFullBlocks(state, ty.id, "nights", ["2A", "4B", "7A", "9A"]);

    const diagnostics = validateSchedule(state);
    const warning = diagnostics.find((item) => item.code === "preference.days-nights-adjacency");

    expect(diagnostics.some((item) => item.code.startsWith("ty."))).toBe(false);
    expect(diagnostics.some((item) => item.code.startsWith("rule."))).toBe(false);
    expect(warning?.severity).toBe("warning");
  });

  it("rejects Nights that are too close or too far apart", () => {
    const tooClose = resident("too-close", false, "fm");
    const tooFar = resident("too-far", false, "fm");
    const state = stateWith([tooClose, tooFar]);
    assignFullBlocks(state, tooClose.id, "medicine", ["1A", "1B", "3B", "4A", "6A"]);
    assignFullBlocks(state, tooClose.id, "nights", ["2A", "3A", "7A"]);
    assignFullBlocks(state, tooFar.id, "medicine", ["1A", "1B", "3B", "4A", "6A"]);
    assignFullBlocks(state, tooFar.id, "nights", ["1A", "5A", "10A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.filter((item) => item.code === "rule.nights-spacing")).toHaveLength(2);
  });

  it("rejects Medicine chunks that are too close or too far apart", () => {
    const tooClose = resident("too-close", false, "fm");
    const tooFar = resident("too-far", false, "fm");
    const state = stateWith([tooClose, tooFar]);
    assignFullBlocks(state, tooClose.id, "medicine", ["1A", "1B", "3A", "3B", "6A"]);
    assignFullBlocks(state, tooClose.id, "nights", ["2A", "4B", "7A"]);
    assignFullBlocks(state, tooFar.id, "medicine", ["1A", "1B", "6A", "6B", "9B"]);
    assignFullBlocks(state, tooFar.id, "nights", ["2A", "4B", "7A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.filter((item) => item.code === "rule.medicine-spacing")).toHaveLength(2);
  });

  it("rejects TY Medicine blocks that are not distributed as three 2-block chunks", () => {
    const ty = resident("ty-intern", false, "ty");
    const state = stateWith([ty]);
    assignFullBlocks(state, ty.id, "medicine", ["1A", "1B", "2A", "3A", "3B", "5A"]);
    assignFullBlocks(state, ty.id, "nights", ["6A", "7A", "8A", "9A"]);

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "ty.medicine.total")).toBe(false);
    expect(diagnostics.some((item) => item.code === "ty.medicine.distribution")).toBe(true);
    expect(diagnostics.some((item) => item.code === "ty.nights.total")).toBe(false);
  });

  it("enforces rotation maximum capacity", () => {
    const medicine = { ...defaultRotations.find((rotation) => rotation.id === "medicine")!, minPerBlock: 0, maxPerBlock: 1 };
    const first = resident("first");
    const second = resident("second");
    const state = stateWith([first, second], [medicine]);
    state.assignments[first.id][blockId("1A")] = fullRotationCell("medicine");
    state.assignments[second.id][blockId("1A")] = fullRotationCell("medicine");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "capacity.max" && item.rotationId === "medicine")).toBe(true);
  });

  it("rejects full PTO with a rotation assignment", () => {
    const intern = resident("intern");
    intern.ptoByBlock[blockId("1A")] = "full";
    const state = stateWith([intern]);
    state.assignments[intern.id][blockId("1A")] = fullRotationCell("medicine");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "pto.full-conflict")).toBe(true);
  });

  it("counts FM half-block PTO paired with FM Clinic without error", () => {
    const intern = resident("intern", false, "fm");
    intern.ptoByBlock[blockId("1A")] = "first-half";
    const state = stateWith([intern]);
    state.assignments[intern.id][blockId("1A")] = {
      ...ptoCell("first-half"),
      secondHalf: { kind: "rotation", rotationId: "family-medicine" }
    };

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "pto.split-ineligible")).toBe(false);
  });

  it("rejects PTO splits with rotations that are not split eligible", () => {
    const intern = resident("intern", false, "fm");
    intern.ptoByBlock[blockId("1A")] = "first-half";
    const state = stateWith([intern]);
    state.assignments[intern.id][blockId("1A")] = {
      ...ptoCell("first-half"),
      secondHalf: { kind: "rotation", rotationId: "medicine" }
    };

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code === "pto.split-ineligible")).toBe(true);
  });

  it("describes protected PTO Elective selections as Elective", () => {
    expect(describeCell(ptoCell("elective"), defaultRotations)).toBe("Elective");
  });

  it("displays labeled manual electives", () => {
    const intern = resident("intern");
    const state = stateWith([intern]);
    state.assignments[intern.id][blockId("1A")] = fullRotationCell("elective", "Research");

    const diagnostics = validateSchedule(state);

    expect(diagnostics.some((item) => item.code.includes("elective"))).toBe(false);
    expect(describeCell(state.assignments[intern.id][blockId("1A")], state.rotations)).toBe("Elective: Research");
  });

  it("drops elective labels when changing away from Elective", () => {
    const intern = resident("intern");
    let state = stateWith([intern]);
    state = setFullAssignment(state, intern.id, blockId("1A"), "elective");
    state = setElectiveLabel(state, intern.id, blockId("1A"), "Research");
    state = setFullAssignment(state, intern.id, blockId("1A"), "medicine");

    expect(describeCell(state.assignments[intern.id][blockId("1A")], state.rotations)).toBe("Medicine");
  });
});
