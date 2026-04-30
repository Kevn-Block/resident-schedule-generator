import * as XLSX from "xlsx";
import type { AppState, Diagnostic } from "../types";
import { blockLabel, describeCell, orderedBlocks } from "./schedule";

export function exportScheduleXlsx(state: AppState, diagnostics: Diagnostic[]) {
  const blocks = orderedBlocks(state);
  const scheduleRows = state.residents.map((resident) => {
    const row: Record<string, string> = {
      Resident: resident.name,
      PGY: `PGY${resident.pgyLevel}`,
      Chief: resident.isChief ? "Yes" : "No"
    };

    for (const block of blocks) {
      row[block.name] = describeCell(state.assignments[resident.id]?.[block.id], state.rotations);
    }

    return row;
  });

  const rotationRows = state.rotations.map((rotation) => ({
    Rotation: rotation.name,
    "Built In": rotation.builtIn ? "Yes" : "No",
    "Min / Block": rotation.minPerBlock,
    "Max / Block": rotation.maxPerBlock,
    "Can Split With Half PTO": rotation.canSplitWithHalfPto ? "Yes" : "No"
  }));

  const blockRows = blocks.map((block) => ({
    Block: block.name,
    Dates: blockLabel(block)
  }));

  const diagnosticRows = diagnostics.length
    ? diagnostics.map((diagnostic) => ({
        Severity: diagnostic.severity,
        Code: diagnostic.code,
        Message: diagnostic.message
      }))
    : [{ Severity: "info", Code: "valid", Message: "No diagnostics." }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(scheduleRows), "Schedule");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rotationRows), "Rotations");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(blockRows), "Blocks");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(diagnosticRows), "Diagnostics");
  XLSX.writeFile(workbook, "resident-schedule.xlsx", { compression: true });
}

export function downloadJson(state: AppState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "resident-schedule.json";
  link.click();
  URL.revokeObjectURL(url);
}
