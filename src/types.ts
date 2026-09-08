export const presetOptions = [
  { value: "circle", label: "Circle" },
  { value: "path-wave", label: "Path wave" },
  { value: "vision", label: "Vision focus" },
  { value: "scatter", label: "Scatter orbit" },
  { value: "arc", label: "Arc carousel" },
  { value: "orbit-3d-ring", label: "3D · Turntable" },
  { value: "orbit-3d-vertical", label: "3D · Vertical halo" },
  { value: "orbit-3d-tilted", label: "3D · Saturn tilt" },
  { value: "orbit-3d-helix", label: "3D · Double helix" },
  { value: "orbit-3d-eight", label: "3D · Figure eight" },
  { value: "orbit-3d-sphere", label: "3D · Sphere" },
  { value: "cover-flow", label: "Cover Flow" },
  { value: "stack-shuffle", label: "Stack Shuffle" },
  { value: "tunnel", label: "Tunnel" },
  { value: "cylinder", label: "Cylinder" },
  { value: "racetrack", label: "Racetrack" },
  { value: "fan", label: "Fan" },
  { value: "pendulum", label: "Pendulum" },
  { value: "vortex", label: "Vortex" },
  { value: "focus-swap", label: "Focus Swap" },
] as const;

export type PresetId = (typeof presetOptions)[number]["value"];
export type TargetScope = "selection" | "children" | "deep";
export type Direction = "clockwise" | "counterclockwise";
export type OpacityCurve = "linear" | "early" | "late" | "soft" | "sharp";
export type WaveFunction = "sin" | "cos";
export type GeometryShape =
  | "ellipse"
  | "custom-path"
  | "parametric"
  | "sphere"
  | "deck"
  | "shuffle"
  | "tunnel"
  | "cylinder"
  | "racetrack"
  | "focus-deck"
  | "fan"
  | "pendulum"
  | "vortex";

export type DialTransition =
  | {
      type: "spring";
      visualDuration?: number;
      bounce?: number;
      stiffness?: number;
      damping?: number;
      mass?: number;
    }
  | {
      type: "easing" | "tween";
      duration?: number;
      ease?: [number, number, number, number] | string;
    };

export interface MotionSettings {
  preset: PresetId;
  motion: {
    duration: number;
    stagger: number;
    keyframes: number;
    direction: Direction;
    fullCycle: DialTransition;
  };
  geometry: {
    advanced: boolean;
    shape: GeometryShape;
    dynamicScale: boolean;
    customPath: string;
    radiusX: number;
    radiusY: number;
    circleRotation: number;
    depth: number;
    tilt: number;
    turns: number;
    rotation: number;
    orient3d: boolean;
    xWave: WaveFunction;
    yWave: WaveFunction;
    depthWave: WaveFunction;
    xFrequency: number;
    yFrequency: number;
    depthFrequency: number;
    xAmplitude: number;
    yAmplitude: number;
    depthAmplitude: number;
    xPhase: number;
    yPhase: number;
    depthPhase: number;
    yOffset: number;
    shapeAmount: number;
    itemSpread: number;
    depthFalloff: number;
  };
  appearance: {
    nearScale: number;
    farScale: number;
    farOpacity: number;
    fadeStart: number;
    fadeEnd: number;
    opacityCurve: OpacityCurve;
    facePath: boolean;
  };
  other: {
    centerBeforeApply: boolean;
    depthSplit: boolean;
    scope: TargetScope;
  };
}

export interface SelectionSummary {
  selected: number;
  names: string[];
  types: string[];
  targets: Record<TargetScope, TargetPreview>;
}

export interface TargetPreview {
  count: number;
  orbitCount: number;
  frameWidth: number;
  frameHeight: number;
  items: Array<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  }>;
}

export type UiToPluginMessage =
  | { type: "apply"; settings: MotionSettings }
  | { type: "clear"; scope: TargetScope }
  | { type: "refresh-selection" }
  | { type: "resize"; height: number };

export type PluginToUiMessage =
  | { type: "selection"; selection: SelectionSummary }
  | { type: "result"; kind: "success" | "error"; message: string };
