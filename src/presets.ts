import type { MotionSettings, PresetId } from "./types";

export type PresetTuning = {
  geometry: Partial<MotionSettings["geometry"]>;
  appearance: Partial<MotionSettings["appearance"]>;
  other?: Partial<MotionSettings["other"]>;
};

const parametric = (
  values: Partial<MotionSettings["geometry"]>,
): Partial<MotionSettings["geometry"]> => ({
  shape: "parametric",
  orient3d: false,
  xWave: "cos",
  yWave: "sin",
  depthWave: "sin",
  xFrequency: 1,
  yFrequency: 1,
  depthFrequency: 1,
  xAmplitude: 1,
  yAmplitude: 1,
  depthAmplitude: 1,
  xPhase: 0,
  yPhase: 0,
  depthPhase: 0,
  yOffset: 0,
  shapeAmount: 1,
  itemSpread: 1,
  depthFalloff: 1,
  ...values,
});

export const builtInPresetTunings: Record<PresetId, PresetTuning> = {
  circle: {
    geometry: { ...parametric({ shape: "ellipse", depthAmplitude: 0.2 }), depth: 90, tilt: 0, rotation: 0 },
    appearance: { nearScale: 1.08, farScale: 0.82, farOpacity: 0.55 },
  },
  "path-wave": {
    geometry: {
      ...parametric({ shape: "custom-path", depthAmplitude: 0.35 }),
      customPath: "[[0.04,0.68],[0.16,0.43],[0.3,0.3],[0.45,0.55],[0.61,0.72],[0.78,0.42],[0.96,0.34]]",
      depth: 170,
      tilt: 0,
      rotation: 0,
    },
    appearance: { nearScale: 1.16, farScale: 0.68, farOpacity: 0.35, facePath: true },
  },
  vision: {
    geometry: parametric({
      xWave: "sin",
      xAmplitude: 0.92,
      yFrequency: 1,
      yAmplitude: 0.08,
      yPhase: 90,
      depthWave: "cos",
      depth: 340,
      tilt: 0,
      rotation: 0,
    }),
    appearance: { nearScale: 1.32, farScale: 0.5, farOpacity: 0.22 },
  },
  scatter: {
    geometry: parametric({ xFrequency: 2, xPhase: 40, yFrequency: 3, depth: 300, turns: 1, rotation: 10 }),
    appearance: { nearScale: 1.2, farScale: 0.5, farOpacity: 0.2 },
  },
  arc: {
    geometry: parametric({ yAmplitude: -1, yOffset: 0.35, depthAmplitude: 0.55, depth: 210, tilt: 0, rotation: 0 }),
    appearance: { nearScale: 1.18, farScale: 0.65, farOpacity: 0.3 },
  },
  "orbit-3d-ring": {
    geometry: parametric({ orient3d: true, yAmplitude: 0.22, depth: 280, tilt: 0, rotation: 0 }),
    appearance: { nearScale: 1.25, farScale: 0.55, farOpacity: 0.28 },
  },
  "orbit-3d-vertical": {
    geometry: parametric({ orient3d: true, xAmplitude: 0.22, depthWave: "cos", depth: 280, tilt: 0, rotation: 0 }),
    appearance: { nearScale: 1.22, farScale: 0.54, farOpacity: 0.26 },
  },
  "orbit-3d-tilted": {
    geometry: parametric({
      orient3d: true,
      yAmplitude: 0.65,
      depth: 310,
      tilt: 42,
      circleRotation: -28,
      rotation: 0,
    }),
    appearance: { nearScale: 1.24, farScale: 0.52, farOpacity: 0.25 },
  },
  "orbit-3d-helix": {
    geometry: parametric({ orient3d: true, yFrequency: 2, yAmplitude: 0.72, depth: 300, tilt: 0, turns: 1, rotation: 0 }),
    appearance: { nearScale: 1.2, farScale: 0.48, farOpacity: 0.2 },
  },
  "orbit-3d-eight": {
    geometry: parametric({ orient3d: true, xWave: "sin", yFrequency: 2, yAmplitude: 0.62, depthWave: "cos", depth: 280, tilt: 0, rotation: 0 }),
    appearance: { nearScale: 1.2, farScale: 0.5, farOpacity: 0.22 },
  },
  "orbit-3d-sphere": {
    geometry: { ...parametric({ shape: "sphere", orient3d: true }), depth: 300, tilt: 0, rotation: 0 },
    appearance: { nearScale: 1.2, farScale: 0.46, farOpacity: 0.18 },
  },
  "cover-flow": {
    geometry: { ...parametric({ shape: "deck" }), depth: 300, tilt: 0, rotation: 0 },
    appearance: { nearScale: 1.28, farScale: 0.58, farOpacity: 0.2 },
  },
  "stack-shuffle": {
    geometry: { ...parametric({ shape: "shuffle" }), depth: 220, tilt: 0, rotation: 0 },
    appearance: { nearScale: 1.08, farScale: 0.74, farOpacity: 0.45 },
  },
  cylinder: {
    geometry: { ...parametric({ shape: "cylinder" }), depth: 300, tilt: 0, rotation: 0 },
    appearance: { nearScale: 1.22, farScale: 0.5, farOpacity: 0.22 },
  },
  racetrack: {
    geometry: {
      ...parametric({ shape: "custom-path" }),
      customPath: "[[0.22,0.14],[0.78,0.14],[0.86,0.16],[0.93,0.22],[0.97,0.33],[0.98,0.5],[0.97,0.67],[0.93,0.78],[0.86,0.84],[0.78,0.86],[0.22,0.86],[0.14,0.84],[0.07,0.78],[0.03,0.67],[0.02,0.5],[0.03,0.33],[0.07,0.22],[0.14,0.16],[0.22,0.14]]",
      depth: 210,
      tilt: 0,
      rotation: 0,
    },
    appearance: { nearScale: 1.16, farScale: 0.66, farOpacity: 0.32, facePath: true },
  },
  fan: {
    geometry: { ...parametric({ shape: "fan" }), depth: 180, tilt: 0, rotation: 0 },
    appearance: { nearScale: 1.1, farScale: 0.72, farOpacity: 0.4 },
  },
  pendulum: {
    geometry: { ...parametric({ shape: "pendulum" }), depth: 160, tilt: 0, rotation: 0 },
    appearance: { nearScale: 1.08, farScale: 0.76, farOpacity: 0.5 },
  },
  vortex: {
    geometry: { ...parametric({ shape: "vortex" }), depth: 320, tilt: 0, turns: 1, rotation: 0 },
    appearance: { nearScale: 1.22, farScale: 0.44, farOpacity: 0.16 },
  },
  "focus-swap": {
    geometry: { ...parametric({ shape: "focus-deck" }), depth: 300, tilt: 0, rotation: 0 },
    appearance: { nearScale: 1.3, farScale: 0.58, farOpacity: 0.18 },
  },
  "depth-blur": {
    geometry: parametric({ orient3d: true, yAmplitude: 0.22, depth: 320, tilt: 0, rotation: 0 }),
    appearance: { nearScale: 1.28, farScale: 0.5, farOpacity: 0.16, farBlur: 16 },
    other: { serviceLayers: "2" },
  },
};
