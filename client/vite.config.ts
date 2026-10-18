import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the frontend talks to the API through this proxy, so no CORS setup is needed.
const api = { "/api": "http://localhost:3000" };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
});
