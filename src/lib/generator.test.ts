import { describe, expect, it } from "vitest";
import { createDefaultState, createResident, defaultRotations } from "../data/defaults";
import type { AppState, Pgy1Type, Resident } from "../types";
import { generateSchedule } from "./generator";
import { describeCell, fullRotationCell, hasFullBlockRotation, isFullPto } from "./schedule";

function assignFullBlocks(state: AppState, resident: Resident, rotationId: string, blockNames: string[]) {
  for (const blockName of blockNames) {
    state.assignments[resident.id][blockId(state, blockName)] = fullRotationCell(rotationId);
  }
}

function relaxedState(pgy1Type: Pgy1Type = "ty"): AppState {
  return {
    ...createDefaultState([createResident("Intern One", pgy1Type)]),
    rotations: defaultRotations.map((rotation) => ({ ...rotation, minPerBlock: 0 }))
  };
}

function blockId(state: AppState, name: string) {
  return state.blocks.find((block) => block.name === name)!.id;
}

describe("generateSchedule", () => {
  it("does not auto-fill an otherwise empty schedule", () => {
    const state = relaxedState();
    const result = generateSchedule(state);

    expect(result.success).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("ty."))).toBe(true);
    expect(describeCell(result.state.assignments[state.residents[0].id][blockId(state, "1A")], state.rotations)).toBe("");
  });

  it("preserves existing manual assignments", () => {
    const state = relaxedState();
    const resident = state.residents[0];
    state.assignments[resident.id][blockId(state, "1A")] = fullRotationCell("medicine");

    const result = generateSchedule(state);

    expect(result.success).toBe(false);
    expect(hasFullBlockRotation(result.state.assignments[resident.id][blockId(state, "1A")], "medicine")).toBe(true);
  });

  it("clears TY diagnostics when manual assignments satisfy TY requirements", () => {
    const state = relaxedState();
    const resident = state.residents[0];
    assignFullBlocks(state, resident, "medicine", ["1A", "1B", "3A", "3B", "5A", "5B"]);
    assignFullBlocks(state, resident, "nights", ["6A", "7A", "8A", "9A"]);

    const result = generateSchedule(state);

    expect(result.success).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("ty."))).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("block."))).toBe(true);
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
