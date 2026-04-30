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

function hasEarlyPgy2PairForPgy3(state: AppState, resident: Resident) {
  return pairPhaseBlocks(state).some((block) =>
    (["medicine", "nights"] as const).some((rotationId) => {
      const hasPgy3Rotation = hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId);
      const hasPgy2Rotation = state.residents.some(
        (candidate) => candidate.pgyLevel === 2 && hasAnyRotation(state.assignments[candidate.id]?.[block.id], rotationId)
      );
      return hasPgy3Rotation && hasPgy2Rotation;
    })
  );
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

describe("generateSchedule", () => {
  it("generates a valid schedule for the demo cohort", () => {
    const result = generateSchedule(createDemoState());

    expect(result.state.residents.length).toBe(8);
    expect(result.state.blocks.length).toBe(26);
    expect(result.success).toBe(true);
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "preference.pocus-after-icu")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy2.pocus.missing")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgy3.derm.missing")).toBe(false);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "resident.consecutive-missing" && diagnostic.rotationId === "ped-ed")
    ).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "preference.pgy3-early-pairing")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "preference.early-med-nights-load")).toBe(false);
    for (const resident of result.state.residents) {
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

  it("pairs every PGY3 with a PGY2 during the demo pair phase when feasible", () => {
    const result = generateSchedule(createDemoState());

    for (const resident of result.state.residents.filter((item) => item.pgyLevel === 3)) {
      expect(hasEarlyPgy2PairForPgy3(result.state, resident)).toBe(true);
    }
  });

  it("keeps demo residents within the early Medicine/Nights load preference when feasible", () => {
    const result = generateSchedule(createDemoState());

    for (const resident of result.state.residents) {
      expect(earlyMedicineNightsCredit(result.state, resident)).toBeLessThanOrEqual(3);
    }
  });

  it("places PGY2 initial Medicine in 1A when a PGY3 Medicine pair is already there", () => {
    const result = generateSchedule(createDemoState());
    const block1A = result.state.blocks.find((block) => block.name === "1A");
    expect(block1A).toBeDefined();

    const hasPgy3Medicine = result.state.residents.some(
      (resident) => resident.pgyLevel === 3 && hasAnyRotation(result.state.assignments[resident.id]?.[block1A!.id], "medicine")
    );
    const hasPgy2Medicine = result.state.residents.some(
      (resident) => resident.pgyLevel === 2 && hasAnyRotation(result.state.assignments[resident.id]?.[block1A!.id], "medicine")
    );

    expect(hasPgy3Medicine).toBe(true);
    expect(hasPgy2Medicine).toBe(true);
  });
});
