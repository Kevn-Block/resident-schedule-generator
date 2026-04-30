import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/resident-schedule-generator/",
  plugins: [react()]
});
