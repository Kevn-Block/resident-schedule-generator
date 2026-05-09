import type { Block } from "../types";

export const MEDICINE_ROTATION_ID = "medicine";
export const NIGHTS_ROTATION_ID = "nights";
export const MIN_SPREAD_DISTANCE = 4;
export const MAX_SPREAD_DISTANCE = 8;

export function isSpreadDistanceAllowed(distance: number) {
  return distance >= MIN_SPREAD_DISTANCE && distance <= MAX_SPREAD_DISTANCE;
}

export function isFmOnlyLateBlock(block: Block, rotationId: string) {
  if (rotationId === MEDICINE_ROTATION_ID) {
    return block.number === 13 && (block.letter === "A" || block.letter === "B");
  }

  if (rotationId === NIGHTS_ROTATION_ID) {
    return block.number === 13 && block.letter === "B";
  }

  return false;
}
