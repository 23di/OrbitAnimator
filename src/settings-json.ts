import { presetOptions, type MotionSettings } from "./types";

const maximumSettingsJsonLength = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeCompatible(template: unknown, incoming: unknown, path: string): unknown {
  if (typeof template === "number") {
    if (typeof incoming !== "number" || !Number.isFinite(incoming)) {
      throw new Error(`${path} must be a finite number.`);
    }
    return incoming;
  }
  if (typeof template === "string" || typeof template === "boolean") {
    if (typeof incoming !== typeof template) {
      throw new Error(`${path} has the wrong type.`);
    }
    return incoming;
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(incoming) || incoming.length !== template.length ||
      incoming.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`${path} must contain ${template.length} finite numbers.`);
    }
    return [...incoming];
  }
  if (isRecord(template)) {
    if (!isRecord(incoming)) throw new Error(`${path} must be an object.`);
    const result: Record<string, unknown> = {};
    for (const [key, fallback] of Object.entries(template)) {
      result[key] = key in incoming
        ? mergeCompatible(fallback, incoming[key], `${path}.${key}`)
        : fallback;
    }
    return result;
  }
  return template;
}

function oneOf(value: string, values: readonly string[], path: string): void {
  if (!values.includes(value)) throw new Error(`${path} contains an unsupported value.`);
}

export function serializeSettingsJson(settings: MotionSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function parseSettingsJson(text: string, current: MotionSettings): MotionSettings {
  if (!text.trim()) throw new Error("Clipboard is empty.");
  if (text.length > maximumSettingsJsonLength) throw new Error("Settings JSON is too large.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Clipboard does not contain valid JSON.");
  }
  const candidate = isRecord(parsed) && isRecord(parsed.settings) ? parsed.settings : parsed;
  if (!isRecord(candidate) || !isRecord(candidate.motion) || !isRecord(candidate.geometry) ||
    !isRecord(candidate.appearance) || !isRecord(candidate.other)) {
    throw new Error("This is not an Orbit Animator settings JSON.");
  }

  const settings = mergeCompatible(current, candidate, "settings") as MotionSettings;
  oneOf(settings.preset, presetOptions.map((preset) => preset.value), "settings.preset");
  oneOf(settings.motion.direction, ["clockwise", "counterclockwise"], "settings.motion.direction");
  oneOf(settings.geometry.shape, [
    "ellipse", "custom-path", "parametric", "sphere", "deck", "shuffle", "tunnel",
    "cylinder", "racetrack", "focus-deck", "fan", "pendulum", "vortex",
  ], "settings.geometry.shape");
  for (const wave of [settings.geometry.xWave, settings.geometry.yWave, settings.geometry.depthWave]) {
    oneOf(wave, ["sin", "cos"], "settings.geometry wave");
  }
  oneOf(settings.appearance.opacityCurve, ["linear", "early", "late", "soft", "sharp"], "settings.appearance.opacityCurve");
  oneOf(settings.other.serviceLayers, ["0", "2", "3", "4", "5"], "settings.other.serviceLayers");
  oneOf(settings.other.scope, ["selection", "children", "deep"], "settings.other.scope");
  oneOf(settings.motion.fullCycle.type, ["spring", "easing", "tween"], "settings.motion.fullCycle.type");
  return settings;
}
