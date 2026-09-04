// Reads KEY=VALUE lines (dotenv style, no interpolation) and returns a plain object.
import { readFileSync } from "node:fs";

export function loadEnvFile(file, target = {}) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return target;
    throw error;
  }
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    target[key] = value;
  }
  return target;
}
