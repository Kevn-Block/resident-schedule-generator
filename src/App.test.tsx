import { fireEvent, render, screen } from "@testing-library/react";
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

  it("keeps PTO controls hidden until a resident PTO button is opened", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Demo/i }));

    expect(screen.queryByText("Full PTO")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Show PTO/i })[0]);

    expect(screen.getAllByText("Full PTO").length).toBeGreaterThan(0);
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
});
