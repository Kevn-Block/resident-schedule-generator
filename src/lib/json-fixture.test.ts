import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import type { AppState } from "../types";
import { generateSchedule } from "./generator";
import { validateSchedule } from "./validation";

const FIXTURE_PATH = "/Users/kevinblock/Downloads/schedule_with_electives.json";
const fixtureExists = existsSync(FIXTURE_PATH);

function loadFixture(): AppState {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as AppState;
}

describe.skipIf(!fixtureExists)("days-nights adjacency hard rule (real-world fixture)", () => {
  it("flags every Days/Nights adjacency in the existing schedule as an error", () => {
    const state = loadFixture();
    const diagnostics = validateSchedule(state);
    const adjacencyErrors = diagnostics.filter((diagnostic) => diagnostic.code === "rule.days-nights-adjacency");

    expect(adjacencyErrors.length).toBeGreaterThan(0);
    expect(adjacencyErrors.every((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });

  it("regenerates within budget — succeeds without adjacency, or fails cleanly with no-solution", () => {
    const state = loadFixture();
    const startedAt = Date.now();
    const result = generateSchedule(state);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(35_000);

    if (result.success) {
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "rule.days-nights-adjacency")).toBe(false);
    } else {
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "generation.no-solution")).toBe(true);
    }
  }, 45_000);
});
