import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the main scheduler controls", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /Academic Year 2026-2027/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Resident x Block Grid/i })).toBeInTheDocument();
  });

  it("includes the requested rotation options in assignment dropdowns", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Add resident at bottom/i }));

    const assignmentSelect = screen.getByLabelText("New Resident 1A assignment");
    for (const rotationName of ["EM", "OP Ped", "Psych", "Surgery", "Endo", "Uro", "Cardio", "FM Clinic", "ICU"]) {
      expect(within(assignmentSelect).getByRole("option", { name: rotationName })).toBeInTheDocument();
    }
  });

  it("keeps PTO and elective controls hidden until a resident protected-block button is opened", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Demo/i }));

    expect(screen.queryByText("Full PTO")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Show PTO \/ Electives/i })[0]);

    expect(screen.getAllByText("Full PTO").length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText("Avery Chen protected block selections")).getAllByRole("option", { name: "Elective" }).length).toBeGreaterThan(0);
  });

  it("shows PGY1 type controls without old resident levels or count controls", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Demo/i }));

    expect(screen.getAllByLabelText("PGY1 type").length).toBeGreaterThan(0);
    expect(screen.getAllByText("FM PGY1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TY PGY1").length).toBeGreaterThan(0);
    expect(screen.queryByText(/PGY2|PGY3/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: ["Cou", "nts"].join("") })).not.toBeInTheDocument();
  });

  it("updates a resident between FM and TY PGY1 types", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Add resident at bottom/i }));
    fireEvent.change(screen.getByLabelText("PGY1 type"), { target: { value: "ty" } });

    expect(screen.getAllByText("TY PGY1").length).toBeGreaterThan(0);
  });

  it("adds TY unmatched metadata with a write-in field", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Add resident at bottom/i }));

    expect(screen.queryByLabelText("Unmatched")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Matched")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PGY1 type"), { target: { value: "ty" } });
    fireEvent.click(screen.getByLabelText("Unmatched"));
    fireEvent.change(screen.getByLabelText("New Resident unmatched details"), { target: { value: "Applying anesthesia" } });

    expect(screen.getByLabelText("New Resident unmatched details")).toHaveValue("Applying anesthesia");
    expect(screen.getByText("TY PGY1 Unmatched: Applying anesthesia")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PGY1 type"), { target: { value: "fm" } });

    expect(screen.queryByLabelText("Unmatched")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New Resident unmatched details")).not.toBeInTheDocument();
  });

  it("adds TY matched metadata and keeps matched and unmatched exclusive", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Add resident at bottom/i }));
    fireEvent.change(screen.getByLabelText("PGY1 type"), { target: { value: "ty" } });
    fireEvent.click(screen.getByLabelText("Matched"));
    fireEvent.change(screen.getByLabelText("New Resident matched details"), { target: { value: "Internal Medicine" } });

    expect(screen.getByLabelText("New Resident matched details")).toHaveValue("Internal Medicine");
    expect(screen.getByText("TY PGY1 Matched: Internal Medicine")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Unmatched"));

    expect(screen.getByLabelText("Unmatched")).toBeChecked();
    expect(screen.getByLabelText("Matched")).not.toBeChecked();
    expect(screen.queryByLabelText("New Resident matched details")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New Resident unmatched details"), { target: { value: "Applying anesthesia" } });
    expect(screen.getByText("TY PGY1 Unmatched: Applying anesthesia")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Matched"));

    expect(screen.getByLabelText("Matched")).toBeChecked();
    expect(screen.getByLabelText("Unmatched")).not.toBeChecked();
    expect(screen.queryByLabelText("New Resident unmatched details")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PGY1 type"), { target: { value: "fm" } });

    expect(screen.queryByLabelText("Matched")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unmatched")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New Resident matched details")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New Resident unmatched details")).not.toBeInTheDocument();
  });

  it("limits TY PTO to full blocks and pairs FM half PTO with FM Clinic", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Add resident at bottom/i }));
    fireEvent.click(screen.getByRole("button", { name: /Show PTO \/ Electives/i }));

    const protectedSelections = screen.getByLabelText("New Resident protected block selections");
    const blockSelect = within(protectedSelections).getByLabelText("1A");
    expect(within(blockSelect).getByRole("option", { name: "H1 PTO" })).toBeInTheDocument();
    expect(within(blockSelect).getByRole("option", { name: "H2 PTO" })).toBeInTheDocument();

    fireEvent.change(blockSelect, { target: { value: "first-half" } });

    expect(screen.queryByLabelText("New Resident 1A assignment")).not.toBeInTheDocument();
    expect(screen.getByText("H1 PTO / H2 FM Clinic")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PGY1 type"), { target: { value: "ty" } });

    const tyBlockSelect = within(protectedSelections).getByLabelText("1A");
    expect(within(tyBlockSelect).queryByRole("option", { name: "H1 PTO" })).not.toBeInTheDocument();
    expect(within(tyBlockSelect).queryByRole("option", { name: "H2 PTO" })).not.toBeInTheDocument();
    expect(tyBlockSelect).toHaveValue("full");
    expect(screen.getByText("PTO")).toBeInTheDocument();
  });

  it("shows an add resident action at the bottom of the control column", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: /Add resident at bottom/i })).toBeInTheDocument();
  });

  it("names icon-only actions for assistive technology", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Demo/i }));

    expect(screen.getByRole("button", { name: "Export schedule as JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import schedule from JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add resident" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Avery Chen" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Resident block schedule grid" })).toBeInTheDocument();
  });

  it("shows an elective label input when an assignment is Elective", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Add resident at bottom/i }));
    fireEvent.change(screen.getByLabelText("New Resident 1A assignment"), { target: { value: "elective" } });

    const labelInput = screen.getByLabelText("New Resident 1A elective label");
    fireEvent.change(labelInput, { target: { value: "Research" } });

    expect(labelInput).toHaveValue("Research");
  });

  it("uses a PGY1 elective block selection as a protected full-block assignment", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Add resident at bottom/i }));
    fireEvent.click(screen.getByRole("button", { name: /Show PTO \/ Electives/i }));
    fireEvent.change(within(screen.getByLabelText("New Resident protected block selections")).getByLabelText("1A"), {
      target: { value: "elective" }
    });

    expect(screen.queryByLabelText("New Resident 1A assignment")).not.toBeInTheDocument();
    expect(screen.getAllByText("Elective").length).toBeGreaterThan(0);

    const labelInput = screen.getByLabelText("New Resident 1A protected elective label");
    fireEvent.change(labelInput, { target: { value: "Research" } });

    expect(labelInput).toHaveValue("Research");
    expect(screen.getByText("Elective: Research")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));

    expect(screen.queryByLabelText("New Resident 1A assignment")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New Resident 1A protected elective label")).toHaveValue("Research");
    expect(screen.getByText("Elective: Research")).toBeInTheDocument();
  });
});
