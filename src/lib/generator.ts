import type { AppState, Block, Diagnostic, GenerationResult, Resident } from "../types";
import {
  applyPtoToAssignments,
  cellCredit,
  createAssignmentMatrix,
  fullRotationCell,
  hasAnyRotation,
  hasFullBlockRotation,
  isEmptyCell,
  isHalfPto,
  orderedBlocks,
  rotationCreditsByBlock,
  rotationSegment,
  rotationById
} from "./schedule";
import { hasErrors, validateSchedule } from "./validation";

type Rng = () => number;

const MEDICINE_NIGHTS = ["medicine", "nights"] as const;
const EARLY_MEDICINE_NIGHTS_CAP = 3;

type MedicineNightsRotation = (typeof MEDICINE_NIGHTS)[number];

function seededRng(seed: number): Rng {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function shuffled<T>(items: T[], rng: Rng): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function blockByName(state: AppState, name: string): Block | undefined {
  return state.blocks.find((block) => block.name.toLowerCase() === name.toLowerCase());
}

function nextBlock(state: AppState, block: Block): Block | undefined {
  return orderedBlocks(state).find((candidate) => candidate.order === block.order + 1);
}

function blocksThrough(state: AppState, name: string) {
  const end = blockByName(state, name);
  return end ? orderedBlocks(state).filter((block) => block.order <= end.order) : orderedBlocks(state);
}

function blocksBefore(state: AppState, name: string) {
  const end = blockByName(state, name);
  return end ? orderedBlocks(state).filter((block) => block.order < end.order) : orderedBlocks(state);
}

function pairPhaseBlocks(state: AppState): Block[] {
  const block4B = blockByName(state, "4B");
  if (!block4B) return [];
  return orderedBlocks(state).filter((block) => block.order <= block4B.order);
}

function isPairPhaseBlock(state: AppState, block: Block) {
  const block4B = blockByName(state, "4B");
  return Boolean(block4B && block.order <= block4B.order);
}

function blocksFromNames(state: AppState, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return orderedBlocks(state).filter((block) => wanted.has(block.name.toLowerCase()));
}

function capacityAllows(state: AppState, block: Block, rotationId: string, additionalCredit: number) {
  const rotation = rotationById(state.rotations, rotationId);
  if (!rotation) return false;
  return rotationCreditsByBlock(state, block.id, rotationId) + additionalCredit <= rotation.maxPerBlock + 0.001;
}

function hasAdjacentMedicineNights(state: AppState, resident: Resident, block: Block) {
  const blocks = orderedBlocks(state);
  const index = blocks.findIndex((candidate) => candidate.id === block.id);
  const adjacentBlocks = [index > 0 ? blocks[index - 1] : undefined, index >= 0 ? blocks[index + 1] : undefined];

  return adjacentBlocks.some(
    (candidate) =>
      candidate &&
      MEDICINE_NIGHTS.some((rotationId) => hasAnyRotation(state.assignments[resident.id]?.[candidate.id], rotationId))
  );
}

function canPlaceFull(state: AppState, resident: Resident, block: Block, rotationId: string) {
  const cell = state.assignments[resident.id]?.[block.id];
  if (hasFullBlockRotation(cell, rotationId)) return true;
  if (isMedicineNightsRotation(rotationId) && hasAdjacentMedicineNights(state, resident, block)) return false;
  return Boolean(cell && isEmptyCell(cell) && capacityAllows(state, block, rotationId, 1));
}

function placeFull(state: AppState, resident: Resident, block: Block, rotationId: string) {
  if (!canPlaceFull(state, resident, block, rotationId)) return false;
  state.assignments[resident.id][block.id] = fullRotationCell(rotationId);
  return true;
}

function placeRotationWithHalfPto(state: AppState, resident: Resident, block: Block, rotationId: string) {
  const cell = state.assignments[resident.id]?.[block.id];
  if (!cell) return 0;
  if (hasFullBlockRotation(cell, rotationId)) return 0;
  if (hasAnyRotation(cell, rotationId)) return 0;

  if (isEmptyCell(cell) && capacityAllows(state, block, rotationId, 1)) {
    state.assignments[resident.id][block.id] = fullRotationCell(rotationId);
    return 1;
  }

  const rotation = rotationById(state.rotations, rotationId);
  if (!rotation?.canSplitWithHalfPto || !isHalfPto(cell) || !capacityAllows(state, block, rotationId, 0.5)) {
    return 0;
  }

  if (cell.firstHalf.kind === "empty" && cell.secondHalf.kind === "pto") {
    state.assignments[resident.id][block.id] = {
      firstHalf: rotationSegment(rotationId),
      secondHalf: cell.secondHalf
    };
    return 0.5;
  }

  if (cell.firstHalf.kind === "pto" && cell.secondHalf.kind === "empty") {
    state.assignments[resident.id][block.id] = {
      firstHalf: cell.firstHalf,
      secondHalf: rotationSegment(rotationId)
    };
    return 0.5;
  }

  return 0;
}

function rotationCreditForResident(state: AppState, resident: Resident, rotationId: string, blocks = orderedBlocks(state)) {
  return blocks.reduce((sum, block) => sum + cellCredit(state.assignments[resident.id]?.[block.id], rotationId), 0);
}

function earlyMedicineNightsCredit(state: AppState, resident: Resident) {
  return pairPhaseBlocks(state).reduce((sum, block) => {
    return sum + cellCredit(state.assignments[resident.id]?.[block.id], "medicine") + cellCredit(state.assignments[resident.id]?.[block.id], "nights");
  }, 0);
}

function assignedCreditForResident(state: AppState, resident: Resident) {
  return orderedBlocks(state).reduce((sum, block) => {
    const cell = state.assignments[resident.id]?.[block.id];
    if (!cell) return sum;
    const first = cell.firstHalf.kind === "rotation" ? 0.5 : cell.firstHalf.kind === "pto" ? 0.5 : 0;
    const second = cell.secondHalf.kind === "rotation" ? 0.5 : cell.secondHalf.kind === "pto" ? 0.5 : 0;
    return sum + first + second;
  }, 0);
}

function firstRotationBlock(state: AppState, resident: Resident, rotationId: string) {
  return orderedBlocks(state).find((block) => hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId));
}

function hasPgy3Pair(state: AppState, block: Block, rotationId: string) {
  return state.residents.some(
    (resident) => resident.pgyLevel === 3 && hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId)
  );
}

function hasPgy2PairOnBlock(state: AppState, block: Block, rotationId: MedicineNightsRotation) {
  return state.residents.some(
    (resident) => resident.pgyLevel === 2 && hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId)
  );
}

function hasEarlyPgy2PairForPgy3(state: AppState, resident: Resident) {
  return pairPhaseBlocks(state).some((block) =>
    MEDICINE_NIGHTS.some(
      (rotationId) =>
        hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId) && hasPgy2PairOnBlock(state, block, rotationId)
    )
  );
}

function hasUnpairedPgy3OnRotation(state: AppState, block: Block, rotationId: string) {
  return state.residents.some(
    (resident) =>
      resident.pgyLevel === 3 &&
      hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId) &&
      !hasEarlyPgy2PairForPgy3(state, resident)
  );
}

function preferredPgy3PairResidents(state: AppState, block: Block, rotationId: string, rng: Rng) {
  return shuffled(
    state.residents.filter((resident) => resident.pgyLevel === 3),
    rng
  ).sort((first, second) => {
    if (isPairPhaseBlock(state, block)) {
      const firstPaired = hasEarlyPgy2PairForPgy3(state, first) ? 1 : 0;
      const secondPaired = hasEarlyPgy2PairForPgy3(state, second) ? 1 : 0;
      if (firstPaired !== secondPaired) return firstPaired - secondPaired;

      const firstOverCap = earlyMedicineNightsCredit(state, first) >= EARLY_MEDICINE_NIGHTS_CAP ? 1 : 0;
      const secondOverCap = earlyMedicineNightsCredit(state, second) >= EARLY_MEDICINE_NIGHTS_CAP ? 1 : 0;
      if (firstOverCap !== secondOverCap) return firstOverCap - secondOverCap;
    }

    const firstAlreadyOnRotation = hasAnyRotation(state.assignments[first.id]?.[block.id], rotationId) ? 0 : 1;
    const secondAlreadyOnRotation = hasAnyRotation(state.assignments[second.id]?.[block.id], rotationId) ? 0 : 1;
    if (firstAlreadyOnRotation !== secondAlreadyOnRotation) return firstAlreadyOnRotation - secondAlreadyOnRotation;

    return assignedCreditForResident(state, first) - assignedCreditForResident(state, second);
  });
}

function oppositeMedicineNightsRotation(rotationId: string) {
  if (rotationId === "medicine") return "nights";
  if (rotationId === "nights") return "medicine";
  return undefined;
}

function hasAdjacentOppositeMedicineNights(state: AppState, resident: Resident, block: Block, rotationId: string) {
  const opposite = oppositeMedicineNightsRotation(rotationId);
  if (!opposite) return false;

  const blocks = orderedBlocks(state);
  const index = blocks.findIndex((candidate) => candidate.id === block.id);
  const previous = index > 0 ? blocks[index - 1] : undefined;
  const next = index >= 0 && index < blocks.length - 1 ? blocks[index + 1] : undefined;

  return Boolean(
    (previous && hasFullBlockRotation(state.assignments[resident.id]?.[previous.id], opposite)) ||
      (next && hasFullBlockRotation(state.assignments[resident.id]?.[next.id], opposite))
  );
}

function isMedicineNightsRotation(rotationId: string): rotationId is MedicineNightsRotation {
  return rotationId === "medicine" || rotationId === "nights";
}

function earlyMedicineNightsPlacementPenalty(state: AppState, resident: Resident, block: Block, rotationId: string) {
  if (!isMedicineNightsRotation(rotationId) || !isPairPhaseBlock(state, block)) return 0;

  let penalty = earlyMedicineNightsCredit(state, resident) >= EARLY_MEDICINE_NIGHTS_CAP ? 100 : 0;
  if (resident.pgyLevel === 3 && hasEarlyPgy2PairForPgy3(state, resident)) {
    penalty += 25;
  }
  return penalty;
}

function medicineNightsBlockPreferenceScore(state: AppState, resident: Resident, block: Block, rotationId: string) {
  let score = earlyMedicineNightsPlacementPenalty(state, resident, block, rotationId);
  if (hasAdjacentOppositeMedicineNights(state, resident, block, rotationId)) {
    score += 10;
  }
  return score;
}

function preferredBlocksForRotation(state: AppState, resident: Resident, blocks: Block[], rotationId: string) {
  return blocks
    .map((block, index) => ({ block, index, score: medicineNightsBlockPreferenceScore(state, resident, block, rotationId) }))
    .sort((first, second) => first.score - second.score || first.index - second.index)
    .map((entry) => entry.block);
}

function pgy2PairBlockScore(state: AppState, resident: Resident, block: Block, rotationId: string) {
  let score = medicineNightsBlockPreferenceScore(state, resident, block, rotationId);
  if (
    state.residents.some(
      (candidate) => candidate.pgyLevel === 2 && hasAnyRotation(state.assignments[candidate.id]?.[block.id], rotationId)
    )
  ) {
    score += 60;
  }

  const pgy3sOnRotation = state.residents.filter(
    (candidate) => candidate.pgyLevel === 3 && hasAnyRotation(state.assignments[candidate.id]?.[block.id], rotationId)
  );

  if (hasUnpairedPgy3OnRotation(state, block, rotationId)) {
    score -= 40;
  } else if (pgy3sOnRotation.length > 0) {
    score -= 10;
  }

  return score;
}

function preferredPgy2PairBlocks(state: AppState, resident: Resident, blocks: Block[], rotationId: string) {
  return blocks
    .map((block, index) => ({ block, index, score: pgy2PairBlockScore(state, resident, block, rotationId) }))
    .sort((first, second) => first.score - second.score || first.index - second.index)
    .map((entry) => entry.block);
}

function medicineNightsNeedScore(state: AppState, resident: Resident, block: Block, rotationId: MedicineNightsRotation) {
  if (resident.pgyLevel === 2) {
    const target = rotationId === "medicine" ? state.requirements.pgy2Medicine : state.requirements.pgy2Nights;
    const remaining = Math.max(0, target - rotationCreditForResident(state, resident, rotationId));
    const block4B = blockByName(state, "4B");
    const earlyBlocks = block4B ? orderedBlocks(state).filter((candidate) => candidate.order <= block4B.order) : orderedBlocks(state);
    const needsEarly = block4B && block.order <= block4B.order && rotationCreditForResident(state, resident, rotationId, earlyBlocks) < 1;
    return remaining + (needsEarly ? 4 : 0);
  }

  const block10A = blockByName(state, "10A");
  if (block10A && block.order >= block10A.order) return 0;

  const target = rotationId === "medicine" ? state.requirements.pgy3Medicine : state.requirements.pgy3Nights;
  const before10A = blocksBefore(state, "10A");
  return Math.max(0, target - rotationCreditForResident(state, resident, rotationId, before10A));
}

function coverageCandidates(state: AppState, block: Block, rotationId: MedicineNightsRotation, rng: Rng) {
  return shuffled(state.residents, rng)
    .filter((resident) => canPlaceFull(state, resident, block, rotationId))
    .sort((first, second) => {
      const firstNeed = medicineNightsNeedScore(state, first, block, rotationId);
      const secondNeed = medicineNightsNeedScore(state, second, block, rotationId);
      const firstUrgentNeed = firstNeed >= 4 ? 1 : 0;
      const secondUrgentNeed = secondNeed >= 4 ? 1 : 0;
      if (firstUrgentNeed !== secondUrgentNeed) return secondUrgentNeed - firstUrgentNeed;

      const firstEarlyPenalty = earlyMedicineNightsPlacementPenalty(state, first, block, rotationId);
      const secondEarlyPenalty = earlyMedicineNightsPlacementPenalty(state, second, block, rotationId);
      if (firstEarlyPenalty !== secondEarlyPenalty) return firstEarlyPenalty - secondEarlyPenalty;

      if (firstNeed !== secondNeed) return secondNeed - firstNeed;

      const firstAdjacentPenalty = hasAdjacentOppositeMedicineNights(state, first, block, rotationId) ? 1 : 0;
      const secondAdjacentPenalty = hasAdjacentOppositeMedicineNights(state, second, block, rotationId) ? 1 : 0;
      if (firstAdjacentPenalty !== secondAdjacentPenalty) return firstAdjacentPenalty - secondAdjacentPenalty;

      return assignedCreditForResident(state, first) - assignedCreditForResident(state, second);
    });
}

function candidatePairs(state: AppState, rng: Rng) {
  const blocks = orderedBlocks(state);
  const sameNumber: Array<[Block, Block]> = [];
  const crossNumber: Array<[Block, Block]> = [];

  for (let index = 0; index < blocks.length - 1; index += 1) {
    const pair: [Block, Block] = [blocks[index], blocks[index + 1]];
    if (pair[0].number === pair[1].number) {
      sameNumber.push(pair);
    } else {
      crossNumber.push(pair);
    }
  }

  return [...shuffled(sameNumber, rng), ...shuffled(crossNumber, rng)];
}

function alreadyHasConsecutive(state: AppState, resident: Resident, rotationId: string) {
  const blocks = orderedBlocks(state);
  for (let index = 0; index < blocks.length - 1; index += 1) {
    if (
      hasFullBlockRotation(state.assignments[resident.id]?.[blocks[index].id], rotationId) &&
      hasFullBlockRotation(state.assignments[resident.id]?.[blocks[index + 1].id], rotationId)
    ) {
      return true;
    }
  }
  return false;
}

function placeConsecutive(state: AppState, resident: Resident, rotationId: string, rng: Rng) {
  if (alreadyHasConsecutive(state, resident, rotationId)) return true;

  for (const [first, second] of candidatePairs(state, rng)) {
    if (canPlaceFull(state, resident, first, rotationId) && canPlaceFull(state, resident, second, rotationId)) {
      placeFull(state, resident, first, rotationId);
      placeFull(state, resident, second, rotationId);
      return true;
    }
  }

  return false;
}

function placeFirstPgy2Pair(state: AppState, resident: Resident, rotationId: string, rng: Rng) {
  const earlyBlocks = blocksThrough(state, "4B");
  const first = firstRotationBlock(state, resident, rotationId);
  if (first && first.order <= (blockByName(state, "4B")?.order ?? 7)) {
    if (hasPgy3Pair(state, first, rotationId)) return true;
    for (const pgy3 of preferredPgy3PairResidents(state, first, rotationId, rng)) {
      if (placeFull(state, pgy3, first, rotationId)) return true;
    }
  }

  for (const block of preferredPgy2PairBlocks(state, resident, earlyBlocks, rotationId)) {
    if (!hasUnpairedPgy3OnRotation(state, block, rotationId)) continue;
    if (placeFull(state, resident, block, rotationId)) return true;
  }

  for (const block of preferredPgy2PairBlocks(state, resident, earlyBlocks, rotationId)) {
    if (!canPlaceFull(state, resident, block, rotationId)) continue;
    for (const pgy3 of preferredPgy3PairResidents(state, block, rotationId, rng)) {
      if (hasEarlyPgy2PairForPgy3(state, pgy3)) continue;
      if (!canPlaceFull(state, pgy3, block, rotationId)) continue;
      placeFull(state, resident, block, rotationId);
      placeFull(state, pgy3, block, rotationId);
      return true;
    }
  }

  for (const block of preferredPgy2PairBlocks(state, resident, earlyBlocks, rotationId)) {
    if (!hasPgy3Pair(state, block, rotationId)) continue;
    if (placeFull(state, resident, block, rotationId)) return true;
  }

  for (const block of preferredPgy2PairBlocks(state, resident, earlyBlocks, rotationId)) {
    if (!canPlaceFull(state, resident, block, rotationId)) continue;
    for (const pgy3 of preferredPgy3PairResidents(state, block, rotationId, rng)) {
      if (hasAnyRotation(state.assignments[pgy3.id]?.[block.id], rotationId) || canPlaceFull(state, pgy3, block, rotationId)) {
        placeFull(state, resident, block, rotationId);
        placeFull(state, pgy3, block, rotationId);
        return true;
      }
    }
  }

  return false;
}

function placeInitialPgy2Pairs(state: AppState, rng: Rng) {
  const pgy2s = state.residents.filter((resident) => resident.pgyLevel === 2);

  for (const resident of pgy2s) {
    placeFirstPgy2Pair(state, resident, "medicine", rng);
  }

  for (const resident of pgy2s) {
    placeFirstPgy2Pair(state, resident, "nights", rng);
  }
}

function placeUntilCredit(
  state: AppState,
  resident: Resident,
  rotationId: string,
  targetCredit: number,
  candidateBlocks: Block[],
  rng: Rng,
  allowHalfPto = false
) {
  let currentCredit = rotationCreditForResident(state, resident, rotationId, candidateBlocks);
  if (currentCredit >= targetCredit) return true;

  const remainingBlocks = shuffled(candidateBlocks, rng);

  while (currentCredit < targetCredit && remainingBlocks.length > 0) {
    const [block] = preferredBlocksForRotation(state, resident, remainingBlocks, rotationId);
    remainingBlocks.splice(
      remainingBlocks.findIndex((candidate) => candidate.id === block.id),
      1
    );

    const beforeCredit = cellCredit(state.assignments[resident.id]?.[block.id], rotationId);
    const added = allowHalfPto
      ? placeRotationWithHalfPto(state, resident, block, rotationId)
      : placeFull(state, resident, block, rotationId)
        ? cellCredit(state.assignments[resident.id]?.[block.id], rotationId) - beforeCredit
        : 0;
    currentCredit += added;
  }

  return currentCredit + 0.001 >= targetCredit;
}

function placePgy2Pocus(state: AppState, resident: Resident, rng: Rng) {
  const icuBlock = firstRotationBlock(state, resident, "icu");
  const followingBlock = icuBlock ? nextBlock(state, icuBlock) : undefined;

  if (followingBlock && placeFull(state, resident, followingBlock, "pocus")) {
    return true;
  }

  return placeUntilCredit(state, resident, "pocus", 1, orderedBlocks(state), rng);
}

function placePgy2IcuAndPocus(state: AppState, resident: Resident, rng: Rng) {
  const existingIcu = firstRotationBlock(state, resident, "icu");

  if (existingIcu) {
    placePgy2Pocus(state, resident, rng);
    return rotationCreditForResident(state, resident, "pocus") >= 1;
  }

  for (const icuBlock of shuffled(blocksThrough(state, "6B"), rng)) {
    const pocusBlock = nextBlock(state, icuBlock);
    if (!pocusBlock) continue;
    if (canPlaceFull(state, resident, icuBlock, "icu") && canPlaceFull(state, resident, pocusBlock, "pocus")) {
      placeFull(state, resident, icuBlock, "icu");
      placeFull(state, resident, pocusBlock, "pocus");
      return true;
    }
  }

  placeUntilCredit(state, resident, "icu", 1, blocksThrough(state, "6B"), rng);
  return placePgy2Pocus(state, resident, rng);
}

function placeFixedAssignments(state: AppState, rng: Rng) {
  const block1A = blockByName(state, "1A");
  const block5A = blockByName(state, "5A");

  if (block5A) {
    for (const resident of shuffled(state.residents.filter((item) => item.pgyLevel === 3), rng)) {
      placeFull(state, resident, block5A, "elective");
    }
  }

  if (block1A) {
    let chiefIndex = 0;
    for (const resident of shuffled(state.residents.filter((item) => item.isChief), rng)) {
      const primary = chiefIndex % 2 === 0 ? "medicine" : "nights";
      const fallback = primary === "medicine" ? "nights" : "medicine";
      if (!placeFull(state, resident, block1A, primary)) {
        placeFull(state, resident, block1A, fallback);
      }
      chiefIndex += 1;
    }
  }
}

function placeResidentRequirements(state: AppState, rng: Rng) {
  const pgy2s = shuffled(state.residents.filter((resident) => resident.pgyLevel === 2), rng);
  const pgy3s = shuffled(state.residents.filter((resident) => resident.pgyLevel === 3), rng);
  const allResidents = shuffled(state.residents, rng);

  placeInitialPgy2Pairs(state, rng);

  for (const resident of pgy2s) {
    placePgy2IcuAndPocus(state, resident, rng);
  }

  placeCoverage(state, rng);

  const before10A = blocksBefore(state, "10A");
  for (const resident of pgy3s) {
    placeUntilCredit(state, resident, "medicine", state.requirements.pgy3Medicine, before10A, rng);
    placeUntilCredit(state, resident, "nights", state.requirements.pgy3Nights, before10A, rng);
  }

  for (const resident of pgy2s) {
    placeUntilCredit(state, resident, "medicine", state.requirements.pgy2Medicine, orderedBlocks(state), rng);
    placeUntilCredit(state, resident, "nights", state.requirements.pgy2Nights, orderedBlocks(state), rng);
  }

  for (const resident of allResidents) {
    placeConsecutive(state, resident, "obgyn", rng);
    if (resident.pgyLevel === 2) {
      placeConsecutive(state, resident, "op-peds", rng);
      placeConsecutive(state, resident, "ss-peds", rng);
    } else {
      placeConsecutive(state, resident, "msk", rng);
      placeConsecutive(state, resident, "geri", rng);
      placeConsecutive(state, resident, "ped-ed", rng);
    }
  }

  for (const resident of pgy2s) {
    placeUntilCredit(state, resident, "ent", 1, orderedBlocks(state), rng);
    placeUntilCredit(state, resident, "rheum", 1, orderedBlocks(state), rng);
  }

  for (const resident of pgy3s) {
    placeUntilCredit(state, resident, "derm", 1, orderedBlocks(state), rng);
  }

  for (const resident of pgy2s) {
    placeUntilCredit(state, resident, "family-medicine", state.requirements.pgy2FamilyMedicine, orderedBlocks(state), rng, true);
  }

  for (const resident of pgy3s) {
    placeUntilCredit(state, resident, "family-medicine", state.requirements.pgy3FamilyMedicine, orderedBlocks(state), rng, true);
  }

  for (const resident of pgy2s) {
    placeUntilCredit(state, resident, "elective", state.requirements.pgy2Elective, orderedBlocks(state), rng);
  }

  for (const resident of pgy3s) {
    placeUntilCredit(state, resident, "elective", state.requirements.pgy3Elective, orderedBlocks(state), rng);
  }
}

function topOffRemainingCounts(state: AppState, rng: Rng) {
  const pgy2s = shuffled(state.residents.filter((resident) => resident.pgyLevel === 2), rng);
  const pgy3s = shuffled(state.residents.filter((resident) => resident.pgyLevel === 3), rng);
  const allBlocks = orderedBlocks(state);
  const through6B = blocksThrough(state, "6B");
  const before10A = blocksBefore(state, "10A");

  for (const resident of pgy2s) {
    placeUntilCredit(state, resident, "medicine", state.requirements.pgy2Medicine, allBlocks, rng);
    placeUntilCredit(state, resident, "nights", state.requirements.pgy2Nights, allBlocks, rng);
    placeUntilCredit(state, resident, "icu", 1, through6B, rng);
    placePgy2Pocus(state, resident, rng);
    placeUntilCredit(state, resident, "ent", 1, allBlocks, rng);
    placeUntilCredit(state, resident, "rheum", 1, allBlocks, rng);
    placeUntilCredit(state, resident, "family-medicine", state.requirements.pgy2FamilyMedicine, allBlocks, rng, true);
    placeUntilCredit(state, resident, "elective", state.requirements.pgy2Elective, allBlocks, rng);
  }

  for (const resident of pgy3s) {
    placeUntilCredit(state, resident, "medicine", state.requirements.pgy3Medicine, before10A, rng);
    placeUntilCredit(state, resident, "nights", state.requirements.pgy3Nights, before10A, rng);
    placeUntilCredit(state, resident, "derm", 1, allBlocks, rng);
    placeUntilCredit(state, resident, "family-medicine", state.requirements.pgy3FamilyMedicine, allBlocks, rng, true);
    placeUntilCredit(state, resident, "elective", state.requirements.pgy3Elective, allBlocks, rng);
  }
}

function placeCoverage(state: AppState, rng: Rng) {
  for (const block of orderedBlocks(state)) {
    const hasMedicine = state.residents.some((resident) => hasAnyRotation(state.assignments[resident.id]?.[block.id], "medicine"));
    if (!hasMedicine) {
      for (const resident of coverageCandidates(state, block, "medicine", rng)) {
        if (placeFull(state, resident, block, "medicine")) break;
      }
    }

    const hasNights = state.residents.some((resident) => hasAnyRotation(state.assignments[resident.id]?.[block.id], "nights"));
    if (!hasNights) {
      for (const resident of coverageCandidates(state, block, "nights", rng)) {
        if (placeFull(state, resident, block, "nights")) break;
      }
    }
  }
}

function createCleanState(input: AppState): AppState {
  return applyPtoToAssignments({
    ...input,
    assignments: createAssignmentMatrix(input.residents, input.blocks)
  });
}

function scoreDiagnostics(diagnostics: Diagnostic[]) {
  return diagnostics.reduce((score, diagnostic) => {
    if (diagnostic.severity === "error") return score + 10000;
    if (diagnostic.severity === "warning") return score + 10;
    return score + 1;
  }, 0);
}

export function generateSchedule(input: AppState, attempts = 1000): GenerationResult {
  let bestState = createCleanState(input);
  let bestDiagnostics = validateSchedule(bestState);
  let bestScore = scoreDiagnostics(bestDiagnostics);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const rng = seededRng(9137 + attempt * 7919);
    const state = createCleanState(input);

    placeFixedAssignments(state, rng);
    placeInitialPgy2Pairs(state, rng);
    placeResidentRequirements(state, rng);
    placeCoverage(state, rng);
    topOffRemainingCounts(state, rng);

    const diagnostics = validateSchedule(state);
    const score = scoreDiagnostics(diagnostics);

    if (score < bestScore) {
      bestState = state;
      bestDiagnostics = diagnostics;
      bestScore = score;
    }

    if (score === 0) {
      return { state, diagnostics, success: true };
    }
  }

  if (!hasErrors(bestDiagnostics)) {
    return { state: bestState, diagnostics: bestDiagnostics, success: true };
  }

  return {
    state: bestState,
    diagnostics: [
      {
        severity: "error",
        code: "generator.no-valid-schedule",
        message:
          "The generator could not satisfy all hard rules with the current residents, PTO, capacities, and requirements. Review the diagnostics below, then adjust inputs or edit manually."
      },
      ...bestDiagnostics
    ],
    success: false
  };
}

export function requiredCoverageBlocks(state: AppState, rotationId: "medicine" | "nights") {
  return blocksFromNames(
    state,
    orderedBlocks(state)
      .filter((block) => !state.residents.some((resident) => hasAnyRotation(state.assignments[resident.id]?.[block.id], rotationId)))
      .map((block) => block.name)
  );
}
