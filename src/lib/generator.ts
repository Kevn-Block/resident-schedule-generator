import type { AppState, AssignmentMatrix, Block, Diagnostic, GenerationResult, Pgy1Type, Resident, ScheduleCell } from "../types";
import {
  isFmOnlyLateBlock,
  isSpreadDistanceAllowed,
  MAX_SPREAD_DISTANCE,
  MEDICINE_ROTATION_ID,
  MIN_SPREAD_DISTANCE,
  NIGHTS_ROTATION_ID
} from "./rules";
import { applyPtoToAssignments, emptyCell, fullRotationCell, isEmptyCell, orderedBlocks, ensureAssignmentShape } from "./schedule";
import { hasErrors, validateSchedule } from "./validation";

const GENERATED_ROTATION_IDS = new Set([MEDICINE_ROTATION_ID, NIGHTS_ROTATION_ID]);

const REQUIREMENTS: Record<Pgy1Type, { medicineRuns: number[]; nightsTotal: number }> = {
  fm: { medicineRuns: [2, 2, 1], nightsTotal: 3 },
  ty: { medicineRuns: [2, 2, 2], nightsTotal: 4 }
};

export interface Candidate {
  blockIndexes: number[];
  key: string;
}

export interface ResidentPlan {
  resident: Resident;
  candidates: Candidate[];
  pgy1Type: Pgy1Type;
  requiredCount: number;
}

interface CoverageBounds {
  minCounts: number[];
  maxCounts: number[];
  preferredCounts: number[];
}

interface CoverageSolution {
  assignments: Map<string, Candidate>;
}

interface AssignmentCounts {
  counts: number[];
  fmCounts: number[];
}

export interface SearchTrace {
  onBestState?: (info: {
    rotationId: string;
    cost: number;
    counts: number[];
    fmCounts: number[];
    restart: number;
    iteration: number;
    choices: number[];
  }) => void;
  onSearchExhausted?: (info: { rotationId: string; bestCost: number }) => void;
}

const HARD_COVERAGE_COST = 1_000_000;
const LOCAL_SEARCH_RESTARTS = 1_000;
const LOCAL_SEARCH_ITERATIONS = 3_000;
const SOLVE_DEADLINE_MS = 30_000;
const INTERLEAVING_STRONG_PENALTY = 500;
const INTERLEAVING_MILD_PENALTY = 30;
const INTERLEAVING_IMBALANCE_SLACK = 2;

function isGeneratedSegment(segment: ScheduleCell["firstHalf"]) {
  return segment.kind === "rotation" && Boolean(segment.rotationId && GENERATED_ROTATION_IDS.has(segment.rotationId));
}

function isLockedForGeneration(cell: ScheduleCell | undefined) {
  if (!cell || isEmptyCell(cell)) return false;
  const segments = [cell.firstHalf, cell.secondHalf];
  return segments.some((segment) => !isGeneratedSegment(segment) && segment.kind !== "empty");
}

export function clearGeneratedAssignments(state: AppState): AppState {
  const assignments: AssignmentMatrix = {};

  for (const resident of state.residents) {
    assignments[resident.id] = {};
    for (const block of state.blocks) {
      const current = state.assignments[resident.id]?.[block.id];
      assignments[resident.id][block.id] = current && !isLockedForGeneration(current) ? emptyCell() : current ?? emptyCell();
    }
  }

  return { ...state, assignments };
}

function assignGeneratedRotation(state: AppState, assignments: Map<string, Candidate>, rotationId: string): AppState {
  const next = structuredClone(state);
  const blocks = orderedBlocks(next);

  for (const resident of next.residents) {
    const candidate = assignments.get(resident.id);
    if (!candidate) continue;

    for (const blockIndex of candidate.blockIndexes) {
      const block = blocks[blockIndex];
      next.assignments[resident.id][block.id] = fullRotationCell(rotationId);
    }
  }

  return next;
}

function availabilityForResident(state: AppState, residentId: string) {
  return orderedBlocks(state).map((block) => isEmptyCell(state.assignments[residentId]?.[block.id]));
}

export function availabilityForGeneratedRotation(state: AppState, resident: Resident, rotationId: string) {
  const blocks = orderedBlocks(state);
  const available = availabilityForResident(state, resident.id);

  if (resident.pgy1Type === "fm") return available;

  return available.map((isAvailable, blockIndex) => isAvailable && !isFmOnlyLateBlock(blocks[blockIndex], rotationId));
}

function candidateKey(blockIndexes: number[]) {
  return blockIndexes.join(",");
}

function fullBlockRunsFromIndexes(blockIndexes: number[]) {
  const runs: Array<{ start: number; end: number }> = [];
  const sorted = [...blockIndexes].sort((first, second) => first - second);
  if (sorted.length === 0) return runs;

  let start = sorted[0];
  let end = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const blockIndex = sorted[index];
    if (blockIndex === end + 1) {
      end = blockIndex;
    } else {
      runs.push({ start, end });
      start = blockIndex;
      end = blockIndex;
    }
  }

  runs.push({ start, end });
  return runs;
}

function medicineChunkDistancesAllowed(blockIndexes: number[]) {
  const runs = fullBlockRunsFromIndexes(blockIndexes);

  for (let index = 0; index < runs.length - 1; index += 1) {
    if (!isSpreadDistanceAllowed(runs[index + 1].start - runs[index].end)) return false;
  }

  return true;
}

function assignmentDistancesAllowed(blockIndexes: number[]) {
  for (let index = 0; index < blockIndexes.length - 1; index += 1) {
    if (!isSpreadDistanceAllowed(blockIndexes[index + 1] - blockIndexes[index])) return false;
  }

  return true;
}

function canPlaceRun(selected: Set<number>, indexes: number[]) {
  for (const index of indexes) {
    if (selected.has(index) || selected.has(index - 1) || selected.has(index + 1)) {
      return false;
    }
  }
  return true;
}

function generateMedicineCandidates(available: boolean[], runLengths: number[]): Candidate[] {
  const candidates = new Map<string, Candidate>();

  const placeRun = (runIndex: number, selected: Set<number>) => {
    if (runIndex === runLengths.length) {
      const blockIndexes = [...selected].sort((first, second) => first - second);
      if (!medicineChunkDistancesAllowed(blockIndexes)) return;
      const key = candidateKey(blockIndexes);
      candidates.set(key, { blockIndexes, key });
      return;
    }

    const length = runLengths[runIndex];
    for (let start = 0; start <= available.length - length; start += 1) {
      const indexes = Array.from({ length }, (_, offset) => start + offset);
      if (!indexes.every((index) => available[index])) continue;
      if (!canPlaceRun(selected, indexes)) continue;

      const nextSelected = new Set(selected);
      for (const index of indexes) nextSelected.add(index);
      placeRun(runIndex + 1, nextSelected);
    }
  };

  placeRun(0, new Set());
  return [...candidates.values()].sort((first, second) => first.key.localeCompare(second.key));
}

export function generateCombinationCandidates(available: boolean[], requiredCount: number) {
  const candidates: Candidate[] = [];
  const selected: number[] = [];

  const choose = (start: number) => {
    if (selected.length === requiredCount) {
      const blockIndexes = [...selected];
      candidates.push({
        blockIndexes,
        key: candidateKey(blockIndexes)
      });
      return;
    }

    const remainingNeeded = requiredCount - selected.length;
    for (let index = start; index <= available.length - remainingNeeded; index += 1) {
      if (!available[index]) continue;
      if (selected.length > 0) {
        const distance = index - selected[selected.length - 1];
        if (distance < MIN_SPREAD_DISTANCE) continue;
        if (distance > MAX_SPREAD_DISTANCE) break;
      }
      selected.push(index);
      choose(index + 1);
      selected.pop();
    }
  };

  choose(0);
  return candidates.filter((candidate) => assignmentDistancesAllowed(candidate.blockIndexes));
}

export function nightsAvailableGivenMedicine(nightsBaseAvailable: boolean[], medicineBlockIndexes: number[]) {
  const medicineSet = new Set(medicineBlockIndexes);
  return nightsBaseAvailable.map((isAvailable, blockIndex) => {
    if (!isAvailable) return false;
    if (medicineSet.has(blockIndex)) return false;
    if (medicineSet.has(blockIndex - 1)) return false;
    if (medicineSet.has(blockIndex + 1)) return false;
    return true;
  });
}

export function hasFeasibleNightsCandidate(available: boolean[], requiredCount: number): boolean {
  const selected: number[] = [];
  let found = false;

  const choose = (start: number): void => {
    if (found) return;
    if (selected.length === requiredCount) {
      found = true;
      return;
    }
    const remaining = requiredCount - selected.length;
    for (let index = start; index <= available.length - remaining; index += 1) {
      if (found) return;
      if (!available[index]) continue;
      if (selected.length > 0) {
        const distance = index - selected[selected.length - 1];
        if (distance < MIN_SPREAD_DISTANCE) continue;
        if (distance > MAX_SPREAD_DISTANCE) break;
      }
      selected.push(index);
      choose(index + 1);
      selected.pop();
    }
  };

  choose(0);
  return found;
}

export function buildMedicinePlans(state: AppState): ResidentPlan[] {
  return state.residents.map((resident) => {
    const medicineRuns = REQUIREMENTS[resident.pgy1Type].medicineRuns;
    const medicineAvailable = availabilityForGeneratedRotation(state, resident, MEDICINE_ROTATION_ID);
    const nightsBaseAvailable = availabilityForGeneratedRotation(state, resident, NIGHTS_ROTATION_ID);
    const nightsTotal = REQUIREMENTS[resident.pgy1Type].nightsTotal;

    const candidates = generateMedicineCandidates(medicineAvailable, medicineRuns).filter((medicineCandidate) =>
      hasFeasibleNightsCandidate(nightsAvailableGivenMedicine(nightsBaseAvailable, medicineCandidate.blockIndexes), nightsTotal)
    );

    return {
      resident,
      candidates,
      pgy1Type: resident.pgy1Type,
      requiredCount: medicineRuns.reduce((sum, length) => sum + length, 0)
    };
  });
}

export function buildNightsPlans(state: AppState): ResidentPlan[] {
  const blocks = orderedBlocks(state);

  return state.residents.map((resident) => {
    const baseAvailable = availabilityForGeneratedRotation(state, resident, NIGHTS_ROTATION_ID);
    const nightsTotal = REQUIREMENTS[resident.pgy1Type].nightsTotal;
    const medicineBlockIndexes = blocks
      .map((block, blockIndex) => ({ block, blockIndex }))
      .filter(({ block }) => state.assignments[resident.id]?.[block.id]?.firstHalf.rotationId === MEDICINE_ROTATION_ID)
      .map(({ blockIndex }) => blockIndex);
    const nightsAvailable = nightsAvailableGivenMedicine(baseAvailable, medicineBlockIndexes);

    return {
      resident,
      candidates: generateCombinationCandidates(nightsAvailable, nightsTotal),
      pgy1Type: resident.pgy1Type,
      requiredCount: nightsTotal
    };
  });
}

function preferredCoverageBounds(totalRequired: number, blockCount: number, minPerBlock: number, maxPerBlock: number): CoverageBounds | null {
  const minimumRequired = blockCount * minPerBlock;
  const maximumAllowed = blockCount * maxPerBlock;
  if (totalRequired < minimumRequired || totalRequired > maximumAllowed) return null;

  let extra = totalRequired - minimumRequired;
  const preferredCounts = Array.from({ length: blockCount }, () => minPerBlock);
  for (let index = 0; index < blockCount && extra > 0; index += 1) {
    const addition = Math.min(extra, maxPerBlock - minPerBlock);
    preferredCounts[index] += addition;
    extra -= addition;
  }

  return {
    minCounts: preferredCounts,
    maxCounts: preferredCounts,
    preferredCounts
  };
}

function flexibleCoverageBounds(totalRequired: number, blockCount: number, minPerBlock: number, maxPerBlock: number): CoverageBounds | null {
  const preferred = preferredCoverageBounds(totalRequired, blockCount, minPerBlock, maxPerBlock);
  if (!preferred) return null;

  return {
    minCounts: Array.from({ length: blockCount }, () => minPerBlock),
    maxCounts: Array.from({ length: blockCount }, () => maxPerBlock),
    preferredCounts: preferred.preferredCounts
  };
}

// Under the hard days/nights adjacency rule, FM-only late blocks (13A/13B
// Medicine, 13B Nights) form a knife-edge: 5 FM residents must split exactly
// 3-on-Medicine + 2-on-Nights with zero overlap. Capping max == min there
// turns over-coverage into a HARD violation so the local search abandons
// 4-FM-on-Medicine arrangements immediately. Safety guard: if the cap would
// drop total capacity below the required credit, leave bounds untouched.
function clampFmOnlyLateBlockBounds(
  bounds: CoverageBounds,
  blocks: Block[],
  rotationId: string,
  totalRequired: number
) {
  const newMax = bounds.maxCounts.slice();
  const newPreferred = bounds.preferredCounts.slice();
  for (let i = 0; i < blocks.length; i += 1) {
    if (!isFmOnlyLateBlock(blocks[i], rotationId)) continue;
    newMax[i] = bounds.minCounts[i];
    newPreferred[i] = bounds.minCounts[i];
  }
  const totalMaxCapacity = newMax.reduce((sum, value) => sum + value, 0);
  if (totalMaxCapacity < totalRequired) return;
  bounds.maxCounts = newMax;
  bounds.preferredCounts = newPreferred;
}

function createSeededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function countAssignments(plans: ResidentPlan[], choices: number[], blockCount: number): AssignmentCounts {
  const counts = Array.from({ length: blockCount }, () => 0);
  const fmCounts = Array.from({ length: blockCount }, () => 0);

  choices.forEach((candidateIndex, planIndex) => {
    const plan = plans[planIndex];
    const candidate = plan.candidates[candidateIndex];
    for (const blockIndex of candidate.blockIndexes) {
      counts[blockIndex] += 1;
      if (plan.pgy1Type === "fm") fmCounts[blockIndex] += 1;
    }
  });

  return { counts, fmCounts };
}

export function residentInterleavingCost(medIdx: number[], nightIdx: number[], blockCount: number) {
  if (medIdx.length === 0 || nightIdx.length === 0) return 0;

  let medMin = medIdx[0];
  let medMax = medIdx[0];
  for (const value of medIdx) {
    if (value < medMin) medMin = value;
    if (value > medMax) medMax = value;
  }

  let nightMin = nightIdx[0];
  let nightMax = nightIdx[0];
  for (const value of nightIdx) {
    if (value < nightMin) nightMin = value;
    if (value > nightMax) nightMax = value;
  }

  let cost = 0;
  if (nightMin > medMax) cost += INTERLEAVING_STRONG_PENALTY;
  if (nightMax < medMin) cost += INTERLEAVING_STRONG_PENALTY;

  const mid = Math.floor(blockCount / 2);
  let firstHalf = 0;
  let secondHalf = 0;
  for (const value of medIdx) {
    if (value < mid) firstHalf += 1;
    else secondHalf += 1;
  }
  for (const value of nightIdx) {
    if (value < mid) firstHalf += 1;
    else secondHalf += 1;
  }

  const imbalance = Math.abs(firstHalf - secondHalf);
  if (imbalance > INTERLEAVING_IMBALANCE_SLACK) {
    cost += INTERLEAVING_MILD_PENALTY * (imbalance - INTERLEAVING_IMBALANCE_SLACK);
  }

  return cost;
}

function coverageCost(
  assignmentCounts: AssignmentCounts,
  bounds: CoverageBounds,
  blocks: Block[],
  rotationId: string
) {
  let cost = 0;

  for (let blockIndex = 0; blockIndex < assignmentCounts.counts.length; blockIndex += 1) {
    const count = assignmentCounts.counts[blockIndex];
    const minCount = bounds.minCounts[blockIndex];
    const maxCount = bounds.maxCounts[blockIndex];

    if (count < minCount) cost += (minCount - count) * HARD_COVERAGE_COST;
    if (count > maxCount) cost += (count - maxCount) * HARD_COVERAGE_COST;

    cost += Math.abs(count - bounds.preferredCounts[blockIndex]) * 10;

    if (!isFmOnlyLateBlock(blocks[blockIndex], rotationId) && assignmentCounts.fmCounts[blockIndex] > 1) {
      cost += (assignmentCounts.fmCounts[blockIndex] - 1) * 100;
    }
  }

  return cost;
}

function solutionFromChoices(plans: ResidentPlan[], choices: number[]): CoverageSolution {
  return {
    assignments: new Map(plans.map((plan, planIndex) => [plan.resident.id, plan.candidates[choices[planIndex]]]))
  };
}

function perturbChoice(plans: ResidentPlan[], choices: number[], random: () => number) {
  const planIndex = Math.floor(random() * plans.length);
  if (plans[planIndex].candidates.length <= 1) return;

  let nextChoice = Math.floor(random() * plans[planIndex].candidates.length);
  if (nextChoice === choices[planIndex]) {
    nextChoice = (nextChoice + 1) % plans[planIndex].candidates.length;
  }
  choices[planIndex] = nextChoice;
}

function planIndexToMutate(
  plans: ResidentPlan[],
  choices: number[],
  assignmentCounts: AssignmentCounts,
  bounds: CoverageBounds,
  random: () => number
) {
  const badBlocks = assignmentCounts.counts
    .map((count, blockIndex) => ({ count, blockIndex }))
    .filter(({ count, blockIndex }) => count < bounds.minCounts[blockIndex] || count > bounds.maxCounts[blockIndex]);

  if (badBlocks.length === 0) return Math.floor(random() * plans.length);

  const target = badBlocks[Math.floor(random() * badBlocks.length)];
  const needsMoreCoverage = target.count < bounds.minCounts[target.blockIndex];
  const planIndexes = plans
    .map((plan, planIndex) => ({ plan, planIndex }))
    .filter(({ plan, planIndex }) => {
      if (needsMoreCoverage) return plan.candidates.some((candidate) => candidate.blockIndexes.includes(target.blockIndex));
      return plan.candidates[choices[planIndex]].blockIndexes.includes(target.blockIndex);
    })
    .map(({ planIndex }) => planIndex);

  if (planIndexes.length === 0) return Math.floor(random() * plans.length);
  return planIndexes[Math.floor(random() * planIndexes.length)];
}

function findCoverageSolution(
  plans: ResidentPlan[],
  blocks: Block[],
  bounds: CoverageBounds,
  rotationId: string,
  acceptSolution: (solution: CoverageSolution) => boolean = () => true,
  deadline: number = Date.now() + SOLVE_DEADLINE_MS,
  trace?: SearchTrace,
  extraCost?: (choices: number[]) => number
): CoverageSolution | null {
  if (plans.some((plan) => plan.candidates.length === 0)) return null;

  const blockCount = blocks.length;
  const random = createSeededRandom(rotationId === MEDICINE_ROTATION_ID ? 42 : 99);
  const rejectedSolutions = new Set<string>();
  let bestCostObserved = Number.POSITIVE_INFINITY;
  const evaluate = (choices: number[]) => {
    const counts = countAssignments(plans, choices, blockCount);
    const coverage = coverageCost(counts, bounds, blocks, rotationId);
    const extra = extraCost ? extraCost(choices) : 0;
    return { counts, cost: coverage + extra, coverage, extra };
  };

  const recordIfBest = (cost: number, counts: AssignmentCounts, choices: number[], restart: number, iteration: number) => {
    if (!trace?.onBestState || cost >= bestCostObserved) return;
    bestCostObserved = cost;
    trace.onBestState({
      rotationId,
      cost,
      counts: counts.counts.slice(),
      fmCounts: counts.fmCounts.slice(),
      restart,
      iteration,
      choices: choices.slice()
    });
  };

  for (let restart = 0; restart < LOCAL_SEARCH_RESTARTS; restart += 1) {
    if (Date.now() > deadline) {
      trace?.onSearchExhausted?.({ rotationId, bestCost: bestCostObserved });
      return null;
    }
    const choices = plans.map((plan) => Math.floor(random() * plan.candidates.length));
    let evaluation = evaluate(choices);
    let counts = evaluation.counts;
    let cost = evaluation.cost;
    let coverage = evaluation.coverage;
    let extra = evaluation.extra;
    recordIfBest(cost, counts, choices, restart, 0);

    for (let iteration = 0; iteration < LOCAL_SEARCH_ITERATIONS; iteration += 1) {
      if ((iteration & 0xff) === 0 && Date.now() > deadline) {
        trace?.onSearchExhausted?.({ rotationId, bestCost: bestCostObserved });
        return null;
      }
      const coverageFeasible = coverage < HARD_COVERAGE_COST;
      const interleavingAcceptable = extra < INTERLEAVING_STRONG_PENALTY;
      if (coverageFeasible && interleavingAcceptable) {
        const solutionKey = choices.map((choice, planIndex) => `${plans[planIndex].resident.id}:${plans[planIndex].candidates[choice].key}`).join("|");

        if (!rejectedSolutions.has(solutionKey)) {
          const solution = solutionFromChoices(plans, choices);
          if (acceptSolution(solution)) return solution;
          rejectedSolutions.add(solutionKey);
        }

        perturbChoice(plans, choices, random);
        evaluation = evaluate(choices);
        counts = evaluation.counts;
        cost = evaluation.cost;
        coverage = evaluation.coverage;
        extra = evaluation.extra;
        recordIfBest(cost, counts, choices, restart, iteration);
        continue;
      }

      const planIndex = planIndexToMutate(plans, choices, counts, bounds, random);
      let bestChoice = choices[planIndex];
      let bestCost = Number.POSITIVE_INFINITY;

      for (let candidateIndex = 0; candidateIndex < plans[planIndex].candidates.length; candidateIndex += 1) {
        choices[planIndex] = candidateIndex;
        const candidateCost = evaluate(choices).cost;

        if (candidateCost < bestCost || (candidateCost === bestCost && random() < 0.03)) {
          bestChoice = candidateIndex;
          bestCost = candidateCost;
        }
      }

      choices[planIndex] = bestChoice;
      evaluation = evaluate(choices);
      counts = evaluation.counts;
      cost = evaluation.cost;
      coverage = evaluation.coverage;
      extra = evaluation.extra;
      recordIfBest(cost, counts, choices, restart, iteration);
    }
  }

  trace?.onSearchExhausted?.({ rotationId, bestCost: bestCostObserved });
  return null;
}

function totalRequired(plans: ResidentPlan[]) {
  return plans.reduce((sum, plan) => sum + plan.requiredCount, 0);
}

function generationFailureDiagnostic(): Diagnostic {
  return {
    severity: "error",
    code: "generation.no-solution",
    message:
      "Generate could not find a Medicine/Nights schedule that satisfies resident requirements and per-block coverage without changing PTO, electives, or locked manual rotations."
  };
}

function solveSchedule(baseState: AppState, trace?: SearchTrace): AppState | null {
  const blocks = orderedBlocks(baseState);
  const blockCount = blocks.length;
  const medicinePlans = buildMedicinePlans(baseState);
  const medicineTotal = totalRequired(medicinePlans);
  const flexibleMedicineBounds = flexibleCoverageBounds(medicineTotal, blockCount, 3, 4);
  if (flexibleMedicineBounds) {
    clampFmOnlyLateBlockBounds(flexibleMedicineBounds, blocks, MEDICINE_ROTATION_ID, medicineTotal);
  }
  const boundPairs = [flexibleMedicineBounds].filter((bounds): bounds is CoverageBounds => Boolean(bounds));
  const deadline = Date.now() + SOLVE_DEADLINE_MS;

  for (const medicineBounds of boundPairs) {
    let solvedState: AppState | null = null;
    const medicineSolution = findCoverageSolution(
      medicinePlans,
      blocks,
      medicineBounds,
      MEDICINE_ROTATION_ID,
      (candidateMedicineSolution) => {
        const withMedicine = assignGeneratedRotation(baseState, candidateMedicineSolution.assignments, MEDICINE_ROTATION_ID);
        const nightsPlans = buildNightsPlans(withMedicine);
        const nightsTotal = totalRequired(nightsPlans);
        const flexibleNightsBounds = flexibleCoverageBounds(nightsTotal, blockCount, 2, 3);
        if (flexibleNightsBounds) {
          clampFmOnlyLateBlockBounds(flexibleNightsBounds, blocks, NIGHTS_ROTATION_ID, nightsTotal);
        }
        const nightBoundPairs = [flexibleNightsBounds].filter((bounds): bounds is CoverageBounds => Boolean(bounds));

        const medicineIndexesByPlan = nightsPlans.map((plan) => {
          const candidate = candidateMedicineSolution.assignments.get(plan.resident.id);
          return candidate ? candidate.blockIndexes : [];
        });
        const nightsExtraCost = (choices: number[]) => {
          let total = 0;
          for (let planIndex = 0; planIndex < nightsPlans.length; planIndex += 1) {
            const plan = nightsPlans[planIndex];
            const nightsCandidate = plan.candidates[choices[planIndex]];
            total += residentInterleavingCost(medicineIndexesByPlan[planIndex], nightsCandidate.blockIndexes, blockCount);
          }
          return total;
        };

        for (const nightsBounds of nightBoundPairs) {
          const nightsSolution = findCoverageSolution(
            nightsPlans,
            blocks,
            nightsBounds,
            NIGHTS_ROTATION_ID,
            () => true,
            deadline,
            trace,
            nightsExtraCost
          );
          if (!nightsSolution) continue;

          solvedState = assignGeneratedRotation(withMedicine, nightsSolution.assignments, NIGHTS_ROTATION_ID);
          return true;
        }

        return false;
      },
      deadline,
      trace
    );

    if (medicineSolution && solvedState) return solvedState;
  }

  return null;
}

export function generateSchedule(input: AppState, trace?: SearchTrace): GenerationResult {
  const normalizedState = applyPtoToAssignments(ensureAssignmentShape(structuredClone(input)));
  const baseState = clearGeneratedAssignments(normalizedState);
  const solvedState = solveSchedule(baseState, trace);

  if (!solvedState) {
    const diagnostics = [generationFailureDiagnostic(), ...validateSchedule(normalizedState)];
    return {
      state: normalizedState,
      diagnostics,
      success: false
    };
  }

  const diagnostics = validateSchedule(solvedState);

  return {
    state: solvedState,
    diagnostics,
    success: !hasErrors(diagnostics)
  };
}

export function requiredCoverageBlocks() {
  return [];
}
