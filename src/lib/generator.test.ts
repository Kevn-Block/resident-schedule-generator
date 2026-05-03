import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/defaults";
import type { AppState, Resident } from "../types";
import { generateSchedule } from "./generator";
import { cellCredit, hasAnyRotation, hasFullBlockRotation, orderedBlocks } from "./schedule";
import { hasErrors } from "./validation";

function pairPhaseBlocks(state: AppState) {
  const block4B = state.blocks.find((block) => block.name === "4B");
  return block4B ? orderedBlocks(state).filter((block) => block.order <= block4B.order) : [];
}

function earlyMedicineNightsCredit(state: AppState, resident: Resident) {
  return pairPhaseBlocks(state).reduce((sum, block) => {
    return sum + cellCredit(state.assignments[resident.id]?.[block.id], "medicine") + cellCredit(state.assignments[resident.id]?.[block.id], "nights");
  }, 0);
}

function backToBackMedicineNightsPairs(state: AppState, resident: Resident) {
  const blocks = orderedBlocks(state);
  const pairs: string[] = [];

  for (let index = 0; index < blocks.length - 1; index += 1) {
    const currentHasMedicineNights = (["medicine", "nights"] as const).some((rotationId) =>
      hasAnyRotation(state.assignments[resident.id]?.[blocks[index].id], rotationId)
    );
    const nextHasMedicineNights = (["medicine", "nights"] as const).some((rotationId) =>
      hasAnyRotation(state.assignments[resident.id]?.[blocks[index + 1].id], rotationId)
    );

    if (currentHasMedicineNights && nextHasMedicineNights) {
      pairs.push(`${blocks[index].name}+${blocks[index + 1].name}`);
    }
  }

  return pairs;
}

function blockByName(state: AppState, name: string) {
  return state.blocks.find((block) => block.name === name)!;
}

function blocksBefore(state: AppState, name: string) {
  const end = blockByName(state, name);
  return orderedBlocks(state).filter((block) => block.order < end.order);
}

function rotationCreditBefore(state: AppState, resident: Resident, rotationId: string, blockName: string) {
  return blocksBefore(state, blockName).reduce((sum, block) => {
    return sum + cellCredit(state.assignments[resident.id]?.[block.id], rotationId);
  }, 0);
}

function rotationCredit(state: AppState, resident: Resident, rotationId: string) {
  return orderedBlocks(state).reduce((sum, block) => {
    return sum + cellCredit(state.assignments[resident.id]?.[block.id], rotationId);
  }, 0);
}

describe("generateSchedule", () => {
  it("generates a valid schedule for the demo cohort", () => {
    const result = generateSchedule(createDemoState());

    expect(result.state.residents.length).toBe(9);
    expect(result.state.blocks.length).toBe(26);
    expect(result.success).toBe(true);
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "preference.pocus-after-icu")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy2.pocus.missing")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy3.derm.missing")).toBe(false);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "resident.consecutive-missing" && diagnostic.rotationId === "ped-ed")
    ).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "preference.early-med-nights-load")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "resident.too-many-medicine")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "resident.too-many-nights")).toBe(false);
    for (const resident of result.state.residents) {
      expect(rotationCredit(result.state, resident, "medicine")).toBeLessThanOrEqual(3);
      expect(rotationCredit(result.state, resident, "nights")).toBeLessThanOrEqual(3);
      expect(backToBackMedicineNightsPairs(result.state, resident)).toEqual([]);
    }
  });

  it("attempts ICU followed by POCUS for every PGY2 in the demo cohort", () => {
    const result = generateSchedule(createDemoState());
    const blocks = orderedBlocks(result.state);

    for (const resident of result.state.residents.filter((item) => item.pgyLevel === 2)) {
      const icuIndex = blocks.findIndex((block) => hasFullBlockRotation(result.state.assignments[resident.id]?.[block.id], "icu"));
      expect(icuIndex).toBeGreaterThanOrEqual(0);
      expect(hasFullBlockRotation(result.state.assignments[resident.id]?.[blocks[icuIndex + 1]?.id], "pocus")).toBe(true);
    }
  });

  it("generates PGY3 Ped ED and Derm requirements for the demo cohort", () => {
    const result = generateSchedule(createDemoState());
    const blocks = orderedBlocks(result.state);

    for (const resident of result.state.residents.filter((item) => item.pgyLevel === 3)) {
      const dermCredit = blocks.reduce(
        (sum, block) => sum + cellCredit(result.state.assignments[resident.id]?.[block.id], "derm"),
        0
      );
      const hasPedEdPair = blocks.some((block, index) => {
        const next = blocks[index + 1];
        return (
          next &&
          hasFullBlockRotation(result.state.assignments[resident.id]?.[block.id], "ped-ed") &&
          hasFullBlockRotation(result.state.assignments[resident.id]?.[next.id], "ped-ed")
        );
      });
      expect(dermCredit).toBe(1);
      expect(hasPedEdPair).toBe(true);
    }
  });

  it("allows resident-rule pairing warnings to preserve coverage and Medicine/Nights caps", () => {
    const result = generateSchedule(createDemoState());

    expect(result.success).toBe(true);
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("coverage."))).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy2.first-medicine-pairing")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy2.first-nights-pairing")).toBe(true);
    for (const resident of result.state.residents) {
      expect(rotationCredit(result.state, resident, "medicine")).toBeLessThanOrEqual(3);
      expect(rotationCredit(result.state, resident, "nights")).toBeLessThanOrEqual(3);
    }
  });

  it("keeps demo residents within the early Medicine/Nights load preference when feasible", () => {
    const result = generateSchedule(createDemoState());

    for (const resident of result.state.residents) {
      expect(earlyMedicineNightsCredit(result.state, resident)).toBeLessThanOrEqual(3);
    }
  });

  it("fails instead of assigning a fourth Medicine or Nights block for coverage", () => {
    const state = createDemoState();
    state.residents = state.residents.slice(0, 8);

    const result = generateSchedule(state, 100);

    expect(result.success).toBe(false);
    for (const resident of result.state.residents) {
      expect(rotationCredit(result.state, resident, "medicine")).toBeLessThanOrEqual(3);
      expect(rotationCredit(result.state, resident, "nights")).toBeLessThanOrEqual(3);
    }
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "resident.too-many-medicine")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "resident.too-many-nights")).toBe(false);
  });

  it("overrides PGY3 resident rules to finish Medicine and Nights before 10A", () => {
    const state = createDemoState();
    const pgy3 = state.residents.find((resident) => resident.pgyLevel === 3 && !resident.isChief)!;
    const availableBefore10A = new Set(["1A", "2A", "3A", "4A", "5A", "6A"]);

    for (const block of blocksBefore(state, "10A")) {
      pgy3.ptoByBlock[block.id] = availableBefore10A.has(block.name) ? "none" : "full";
    }

    const result = generateSchedule(state, 100);
    const block5A = blockByName(result.state, "5A");
    const pgy3Assignments = result.state.assignments[pgy3.id];
    const elective5AWarning = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "pgy3.elective-5a" && diagnostic.residentId === pgy3.id
    );

    expect(result.success).toBe(true);
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(rotationCreditBefore(result.state, pgy3, "medicine", "10A")).toBe(state.requirements.pgy3Medicine);
    expect(rotationCreditBefore(result.state, pgy3, "nights", "10A")).toBe(state.requirements.pgy3Nights);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy3.medicine.before-10a")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy3.nights.before-10a")).toBe(false);
    expect(elective5AWarning?.severity).toBe("warning");
    expect(
      hasFullBlockRotation(pgy3Assignments[block5A.id], "medicine") || hasFullBlockRotation(pgy3Assignments[block5A.id], "nights")
    ).toBe(true);
  });

  it("does not overwrite PGY3 PTO to satisfy Medicine and Nights before 10A", () => {
    const state = createDemoState();
    const pgy3 = state.residents.find((resident) => resident.pgyLevel === 3 && !resident.isChief)!;

    for (const block of blocksBefore(state, "10A")) {
      pgy3.ptoByBlock[block.id] = "full";
    }

    const result = generateSchedule(state, 20);

    expect(result.success).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy3.medicine.before-10a" && diagnostic.severity === "error")).toBe(
      true
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy3.nights.before-10a" && diagnostic.severity === "error")).toBe(
      true
    );
    for (const block of blocksBefore(result.state, "10A")) {
      const cell = result.state.assignments[pgy3.id][block.id];
      expect(hasAnyRotation(cell, "medicine") || hasAnyRotation(cell, "nights")).toBe(false);
    }
  });
});
