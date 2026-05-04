import type { AppState, Block, Diagnostic, Resident } from "../types";
import {
  assignmentFor,
  cellCredit,
  cellContainsPto,
  hasAnyRotation,
  hasFullBlockRotation,
  orderedBlocks,
  rotationCreditsByBlock,
  rotationById
} from "./schedule";

const PGY2_CONSECUTIVE = [
  ["obgyn", "OBGYN"],
  ["op-peds", "OP Peds"],
  ["ss-peds", "SS Peds"]
] as const;

const PGY3_CONSECUTIVE = [
  ["obgyn", "OBGYN"],
  ["msk", "MSK"],
  ["geri", "Geri"],
  ["ped-ed", "Ped ED"]
] as const;

const MEDICINE_NIGHTS = ["medicine", "nights"] as const;
const EARLY_MEDICINE_NIGHTS_CAP = 3;
const MEDICINE_NIGHTS_TOTAL_CAP = 3;

function pushDiagnostic(
  diagnostics: Diagnostic[],
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  context: Partial<Diagnostic> = {}
) {
  diagnostics.push({ severity, code, message, ...context });
}

function blockByName(blocks: Block[], name: string): Block | undefined {
  return blocks.find((block) => block.name.toLowerCase() === name.toLowerCase());
}

function rotationCreditForResident(state: AppState, resident: Resident, rotationId: string, predicate?: (block: Block) => boolean): number {
  return orderedBlocks(state).reduce((sum, block) => {
    if (predicate && !predicate(block)) return sum;
    return sum + cellCredit(state.assignments[resident.id]?.[block.id], rotationId);
  }, 0);
}

function firstRotationBlock(state: AppState, resident: Resident, rotationId: string): Block | undefined {
  return orderedBlocks(state).find((block) => hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId));
}

function nextBlock(state: AppState, block: Block): Block | undefined {
  return orderedBlocks(state).find((candidate) => candidate.order === block.order + 1);
}

function pairPhaseBlocks(state: AppState): Block[] {
  const block4B = blockByName(state.blocks, "4B");
  if (!block4B) return [];
  return orderedBlocks(state).filter((block) => block.order <= block4B.order);
}

function earlyMedicineNightsCredit(state: AppState, resident: Resident): number {
  return pairPhaseBlocks(state).reduce((sum, block) => {
    return sum + cellCredit(state.assignments[resident.id]?.[block.id], "medicine") + cellCredit(state.assignments[resident.id]?.[block.id], "nights");
  }, 0);
}

function hasPgy2PairOnBlock(state: AppState, block: Block, rotationId: (typeof MEDICINE_NIGHTS)[number]): boolean {
  return state.residents.some(
    (resident) => resident.pgyLevel === 2 && hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId)
  );
}

function hasEarlyPgy2PairForPgy3(state: AppState, resident: Resident): boolean {
  return pairPhaseBlocks(state).some((block) =>
    MEDICINE_NIGHTS.some(
      (rotationId) =>
        hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId) && hasPgy2PairOnBlock(state, block, rotationId)
    )
  );
}

function consecutivePairs(state: AppState, resident: Resident, rotationId: string) {
  const blocks = orderedBlocks(state);
  const pairs: Array<{ first: Block; second: Block; sameNumber: boolean }> = [];

  for (let index = 0; index < blocks.length - 1; index += 1) {
    const first = blocks[index];
    const second = blocks[index + 1];
    if (
      hasFullBlockRotation(state.assignments[resident.id]?.[first.id], rotationId) &&
      hasFullBlockRotation(state.assignments[resident.id]?.[second.id], rotationId)
    ) {
      pairs.push({ first, second, sameNumber: first.number === second.number });
    }
  }

  return pairs;
}

function validateConsecutiveRequirement(
  state: AppState,
  diagnostics: Diagnostic[],
  resident: Resident,
  rotationId: string,
  rotationName: string
) {
  const pairs = consecutivePairs(state, resident, rotationId);
  if (pairs.length === 0) {
    pushDiagnostic(
      diagnostics,
      "error",
      "resident.consecutive-missing",
      `${resident.name} must complete 2 consecutive full blocks of ${rotationName}.`,
      { residentId: resident.id, rotationId }
    );
    return;
  }

  if (!pairs.some((pair) => pair.sameNumber)) {
    const firstPair = pairs[0];
    pushDiagnostic(
      diagnostics,
      "warning",
      "preference.cross-number-pair",
      `${resident.name}'s ${rotationName} pair uses ${firstPair.first.name} + ${firstPair.second.name}; same-number A/B pairs are preferred.`,
      { residentId: resident.id, rotationId, blockId: firstPair.first.id }
    );
  }
}

function validatePtoAndSplitRules(state: AppState, diagnostics: Diagnostic[]) {
  for (const resident of state.residents) {
    for (const block of orderedBlocks(state)) {
      const cell = assignmentFor(state, resident.id, block.id);
      const pto = resident.ptoByBlock[block.id] ?? "none";

      if (pto === "full") {
        const hasRotation = cell.firstHalf.kind === "rotation" || cell.secondHalf.kind === "rotation";
        if (hasRotation) {
          pushDiagnostic(
            diagnostics,
            "error",
            "pto.full-conflict",
            `${resident.name} has full-block PTO in ${block.name} but also has a rotation assignment.`,
            { residentId: resident.id, blockId: block.id }
          );
        }
      }

      if (cellContainsPto(cell)) {
        for (const segment of [cell.firstHalf, cell.secondHalf]) {
          if (segment.kind !== "rotation" || !segment.rotationId) continue;
          const rotation = rotationById(state.rotations, segment.rotationId);
          if (!rotation?.canSplitWithHalfPto) {
            pushDiagnostic(
              diagnostics,
              "error",
              "pto.split-ineligible",
              `${resident.name} has ${rotation?.name ?? segment.rotationId} split with PTO in ${block.name}, but that rotation is not split-eligible.`,
              { residentId: resident.id, blockId: block.id, rotationId: segment.rotationId }
            );
          }
        }
      }
    }
  }
}

function validateCoverage(state: AppState, diagnostics: Diagnostic[]) {
  for (const block of orderedBlocks(state)) {
    const hasMedicine = state.residents.some((resident) => hasAnyRotation(state.assignments[resident.id]?.[block.id], "medicine"));
    const hasNights = state.residents.some((resident) => hasAnyRotation(state.assignments[resident.id]?.[block.id], "nights"));

    if (!hasMedicine) {
      pushDiagnostic(diagnostics, "error", "coverage.missing-days", `${block.name} needs at least one Medicine assignment.`, {
        blockId: block.id,
        rotationId: "medicine"
      });
    }

    if (!hasNights) {
      pushDiagnostic(diagnostics, "error", "coverage.missing-nights", `${block.name} needs at least one Nights assignment.`, {
        blockId: block.id,
        rotationId: "nights"
      });
    }
  }
}

function medicineNightsRotationNames(state: AppState, resident: Resident, block: Block): string[] {
  return MEDICINE_NIGHTS.filter((rotationId) => hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId)).map(
    (rotationId) => (rotationId === "medicine" ? "Medicine" : "Nights")
  );
}

function validateMedicineNightsTransitions(state: AppState, diagnostics: Diagnostic[], resident: Resident) {
  const blocks = orderedBlocks(state);
  for (let index = 0; index < blocks.length - 1; index += 1) {
    const current = blocks[index];
    const next = blocks[index + 1];
    const currentRotations = medicineNightsRotationNames(state, resident, current);
    const nextRotations = medicineNightsRotationNames(state, resident, next);

    for (const currentRotation of currentRotations) {
      for (const nextRotation of nextRotations) {
        const currentRotationId = currentRotation === "Medicine" ? "medicine" : "nights";
        const nextRotationId = nextRotation === "Medicine" ? "medicine" : "nights";
        const sameRotation = currentRotationId === nextRotationId;
        const code = sameRotation
          ? `resident.back-to-back-${currentRotationId}`
          : currentRotationId === "nights"
            ? "resident.nights-to-medicine"
            : "resident.medicine-to-nights";
        const message = sameRotation
          ? `${resident.name} has back-to-back ${currentRotation} blocks in ${current.name} + ${next.name}; consecutive ${currentRotation} blocks are not allowed.`
          : `${resident.name} has ${currentRotation} followed by ${nextRotation} in ${current.name} + ${next.name}; mixed Medicine/Nights adjacency should only happen when unavoidable.`;

        pushDiagnostic(
          diagnostics,
          "error",
          code,
          message,
          { residentId: resident.id, blockId: current.id, rotationId: currentRotationId }
        );
      }
    }
  }
}

function validatePocusAfterIcuPreference(state: AppState, diagnostics: Diagnostic[], resident: Resident) {
  const icuBlock = firstRotationBlock(state, resident, "icu");
  if (!icuBlock || rotationCreditForResident(state, resident, "pocus") < 1) return;

  const followingBlock = nextBlock(state, icuBlock);
  if (followingBlock && hasFullBlockRotation(state.assignments[resident.id]?.[followingBlock.id], "pocus")) return;

  pushDiagnostic(
    diagnostics,
    "warning",
    "preference.pocus-after-icu",
    `${resident.name} should have POCUS immediately after ICU when possible.`,
    { residentId: resident.id, blockId: icuBlock.id, rotationId: "pocus" }
  );
}

function validateEarlyMedicineNightsPreferences(state: AppState, diagnostics: Diagnostic[], resident: Resident) {
  const earlyCredit = earlyMedicineNightsCredit(state, resident);
  if (earlyCredit > EARLY_MEDICINE_NIGHTS_CAP + 0.001) {
    pushDiagnostic(
      diagnostics,
      "warning",
      "preference.early-med-nights-load",
      `${resident.name} has ${earlyCredit.toFixed(1)} Medicine/Nights block-equivalents in Blocks 1A-4B; at most ${EARLY_MEDICINE_NIGHTS_CAP} is preferred.`,
      { residentId: resident.id }
    );
  }

  if (resident.pgyLevel === 3 && pairPhaseBlocks(state).length > 0 && !hasEarlyPgy2PairForPgy3(state, resident)) {
    pushDiagnostic(
      diagnostics,
      "warning",
      "preference.pgy3-early-pairing",
      `${resident.name} should be paired with a PGY2 on Medicine or Nights at least once in Blocks 1A-4B.`,
      { residentId: resident.id }
    );
  }
}

function validateMedicineNightsTotalCaps(state: AppState, diagnostics: Diagnostic[], resident: Resident) {
  for (const rotationId of MEDICINE_NIGHTS) {
    const credit = rotationCreditForResident(state, resident, rotationId);
    if (credit > MEDICINE_NIGHTS_TOTAL_CAP + 0.001) {
      const label = rotationId === "medicine" ? "Medicine" : "Nights";
      pushDiagnostic(
        diagnostics,
        "error",
        `resident.too-many-${rotationId}`,
        `${resident.name} has ${credit.toFixed(1)} ${label} block-equivalents but may have at most ${MEDICINE_NIGHTS_TOTAL_CAP}.`,
        { residentId: resident.id, rotationId }
      );
    }
  }
}

function validateCapacity(state: AppState, diagnostics: Diagnostic[]) {
  for (const block of orderedBlocks(state)) {
    for (const rotation of state.rotations) {
      const credit = rotationCreditsByBlock(state, block.id, rotation.id);
      if (credit + 0.001 < rotation.minPerBlock) {
        pushDiagnostic(
          diagnostics,
          "error",
          "capacity.min",
          `${block.name} has ${credit.toFixed(1)} ${rotation.name} FTE but needs at least ${rotation.minPerBlock}.`,
          { blockId: block.id, rotationId: rotation.id }
        );
      }
      if (credit - 0.001 > rotation.maxPerBlock) {
        pushDiagnostic(
          diagnostics,
          "error",
          "capacity.max",
          `${block.name} has ${credit.toFixed(1)} ${rotation.name} FTE but allows at most ${rotation.maxPerBlock}.`,
          { blockId: block.id, rotationId: rotation.id }
        );
      }
    }
  }
}

function validatePgy2(state: AppState, diagnostics: Diagnostic[], resident: Resident) {
  const block4B = blockByName(state.blocks, "4B");
  const block6B = blockByName(state.blocks, "6B");

  if (block4B) {
    const through4B = (block: Block) => block.order <= block4B.order;
    const earlyMedicine = rotationCreditForResident(state, resident, "medicine", through4B);
    const earlyNights = rotationCreditForResident(state, resident, "nights", through4B);

    if (earlyMedicine < 1) {
      pushDiagnostic(
        diagnostics,
        "error",
        "pgy2.early-medicine",
        `${resident.name} must complete at least one Medicine block by the end of Block 4B.`,
        { residentId: resident.id, rotationId: "medicine" }
      );
    }

    if (earlyNights < 1) {
      pushDiagnostic(
        diagnostics,
        "error",
        "pgy2.early-nights",
        `${resident.name} must complete at least one Nights block by the end of Block 4B.`,
        { residentId: resident.id, rotationId: "nights" }
      );
    }
  }

  for (const [rotationId, label, total] of [
    ["medicine", "Medicine", state.requirements.pgy2Medicine],
    ["nights", "Nights", state.requirements.pgy2Nights],
    ["family-medicine", "Family Medicine", state.requirements.pgy2FamilyMedicine],
    ["elective", "Elective", state.requirements.pgy2Elective]
  ] as const) {
    const credit = rotationCreditForResident(state, resident, rotationId);
    if (credit + 0.001 < total) {
      pushDiagnostic(
        diagnostics,
        "error",
        `pgy2.${rotationId}.total`,
        `${resident.name} needs ${total} ${label} block-equivalent${total === 1 ? "" : "s"} and has ${credit.toFixed(1)}.`,
        { residentId: resident.id, rotationId }
      );
    }
  }

  for (const [rotationId, label] of PGY2_CONSECUTIVE) {
    validateConsecutiveRequirement(state, diagnostics, resident, rotationId, label);
  }

  for (const [rotationId, label] of [
    ["ent", "ENT"],
    ["rheum", "Rheum"],
    ["icu", "ICU"],
    ["pocus", "POCUS"]
  ] as const) {
    const credit = rotationCreditForResident(state, resident, rotationId);
    if (credit < 1) {
      pushDiagnostic(diagnostics, "error", `pgy2.${rotationId}.missing`, `${resident.name} needs 1 block of ${label}.`, {
        residentId: resident.id,
        rotationId
      });
    }
  }

  if (block6B) {
    const lateIcuBlocks = orderedBlocks(state).filter(
      (block) => block.order > block6B.order && hasAnyRotation(state.assignments[resident.id]?.[block.id], "icu")
    );
    for (const block of lateIcuBlocks) {
      pushDiagnostic(
        diagnostics,
        "error",
        "pgy2.icu-window",
        `${resident.name}'s ICU assignment in ${block.name} is outside the allowed 1A-6B window.`,
        { residentId: resident.id, blockId: block.id, rotationId: "icu" }
      );
    }
  }

  for (const rotationId of ["medicine", "nights"]) {
    const firstBlock = firstRotationBlock(state, resident, rotationId);
    if (!firstBlock) continue;
    const hasPgy3Pair = state.residents.some(
      (candidate) =>
        candidate.pgyLevel === 3 && hasAnyRotation(state.assignments[candidate.id]?.[firstBlock.id], rotationId)
    );
    if (!hasPgy3Pair) {
      pushDiagnostic(
        diagnostics,
        "error",
        `pgy2.first-${rotationId}-pairing`,
        `${resident.name}'s first ${rotationId === "medicine" ? "Medicine" : "Nights"} block (${firstBlock.name}) must be paired with a PGY3 on the same rotation.`,
        { residentId: resident.id, blockId: firstBlock.id, rotationId }
      );
    }
  }

  validatePocusAfterIcuPreference(state, diagnostics, resident);
}

function validatePgy3(state: AppState, diagnostics: Diagnostic[], resident: Resident) {
  const block10A = blockByName(state.blocks, "10A");
  const before10A = block10A ? (block: Block) => block.order < block10A.order : undefined;

  for (const [rotationId, label, total] of [
    ["medicine", "Medicine", state.requirements.pgy3Medicine],
    ["nights", "Nights", state.requirements.pgy3Nights]
  ] as const) {
    const credit = rotationCreditForResident(state, resident, rotationId, before10A);
    if (credit + 0.001 < total) {
      pushDiagnostic(
        diagnostics,
        "error",
        `pgy3.${rotationId}.before-10a`,
        `${resident.name} needs ${total} ${label} block-equivalent${total === 1 ? "" : "s"} before Block 10A and has ${credit.toFixed(1)}.`,
        { residentId: resident.id, rotationId }
      );
    }
  }

  for (const [rotationId, label, total] of [
    ["family-medicine", "Family Medicine", state.requirements.pgy3FamilyMedicine],
    ["elective", "Elective", state.requirements.pgy3Elective]
  ] as const) {
    const credit = rotationCreditForResident(state, resident, rotationId);
    if (credit + 0.001 < total) {
      pushDiagnostic(
        diagnostics,
        "error",
        `pgy3.${rotationId}.total`,
        `${resident.name} needs ${total} ${label} block-equivalent${total === 1 ? "" : "s"} and has ${credit.toFixed(1)}.`,
        { residentId: resident.id, rotationId }
      );
    }
  }

  const block5A = blockByName(state.blocks, "5A");
  if (block5A && !hasAnyRotation(state.assignments[resident.id]?.[block5A.id], "elective")) {
    pushDiagnostic(
      diagnostics,
      "error",
      "pgy3.elective-5a",
      `${resident.name} must be on Elective in Block 5A.`,
      { residentId: resident.id, blockId: block5A.id, rotationId: "elective" }
    );
  }

  for (const [rotationId, label] of PGY3_CONSECUTIVE) {
    validateConsecutiveRequirement(state, diagnostics, resident, rotationId, label);
  }

  const dermCredit = rotationCreditForResident(state, resident, "derm");
  if (dermCredit < 1) {
    pushDiagnostic(diagnostics, "error", "pgy3.derm.missing", `${resident.name} needs 1 block of Derm.`, {
      residentId: resident.id,
      rotationId: "derm"
    });
  }
}

function validateChiefs(state: AppState, diagnostics: Diagnostic[]) {
  const block1A = blockByName(state.blocks, "1A");
  if (!block1A) return;

  for (const chief of state.residents.filter((resident) => resident.isChief)) {
    const hasChiefCoverage =
      hasAnyRotation(state.assignments[chief.id]?.[block1A.id], "medicine") ||
      hasAnyRotation(state.assignments[chief.id]?.[block1A.id], "nights");
    if (!hasChiefCoverage) {
      pushDiagnostic(
        diagnostics,
        "error",
        "chief.block-1a",
        `${chief.name} is chief and must be assigned Medicine or Nights in Block 1A.`,
        { residentId: chief.id, blockId: block1A.id }
      );
    }
  }
}

export function validateSchedule(state: AppState): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (state.residents.length === 0) {
    pushDiagnostic(diagnostics, "error", "setup.no-residents", "Add at least one resident before generating a schedule.");
  }

  validatePtoAndSplitRules(state, diagnostics);
  validateCoverage(state, diagnostics);
  validateCapacity(state, diagnostics);
  validateChiefs(state, diagnostics);

  for (const resident of state.residents) {
    if (!resident.name.trim()) {
      pushDiagnostic(diagnostics, "error", "resident.name-missing", "Every resident needs a name.", { residentId: resident.id });
    }

    if (resident.pgyLevel === 2) {
      validatePgy2(state, diagnostics, resident);
    } else {
      validatePgy3(state, diagnostics, resident);
    }
    validateEarlyMedicineNightsPreferences(state, diagnostics, resident);
    validateMedicineNightsTotalCaps(state, diagnostics, resident);
    validateMedicineNightsTransitions(state, diagnostics, resident);
  }

  return diagnostics;
}

export function hasErrors(diagnostics: Diagnostic[]) {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
