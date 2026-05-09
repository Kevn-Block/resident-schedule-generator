import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VERCEL === "1" ? "/" : "/resident-schedule-generator/",
  plugins: [react()]
});
