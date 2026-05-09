import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import type { AppState } from "../types";
import { validateSchedule } from "./validation";

const FIXTURE_PATH = "/Users/kevinblock/Downloads/schedule_with_electives.json";
const fixtureExists = existsSync(FIXTURE_PATH);

describe.skipIf(!fixtureExists)("days-nights adjacency hard rule (real-world fixture)", () => {
  it("flags every Days/Nights adjacency in the existing schedule as an error", () => {
    const state = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as AppState;
    const diagnostics = validateSchedule(state);
    const adjacencyErrors = diagnostics.filter((diagnostic) => diagnostic.code === "rule.days-nights-adjacency");

    expect(adjacencyErrors.length).toBeGreaterThan(0);
    expect(adjacencyErrors.every((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });
});
