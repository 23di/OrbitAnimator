import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { DialRoot, DialStore, useDialKit, type DialConfig } from "dialkit";
import "dialkit/styles.css";
import "./styles.css";
import {
  depthSplitOpacity,
  fitPreviewFrame,
  fitSettingsToFrame,
  generateNodeKeyframes,
  sampleGeneratedKeyframes,
  supportsOrbitOrientation,
  supportsPathGeometry,
} from "./engine";
import { builtInPresetTunings } from "./presets";
import {
  presetOptions,
  type DialTransition,
  type MotionSettings,
  type PluginToUiMessage,
  type PresetId,
  type SelectionSummary,
  type TargetPreview,
  type UiToPluginMessage,
} from "./types";

const controls = {
  preset: {
    type: "select",
    options: presetOptions.map((preset) => ({ value: preset.value, label: preset.label })),
    default: "orbit-3d-ring",
  },
  motion: {
    _collapsed: true,
    duration: [5, 0.4, 12, 0.1],
    stagger: [0, 0, 1.5, 0.01],
    keyframes: [30, 4, 48, 1],
    direction: {
      type: "select",
      options: [
        { value: "clockwise", label: "Clockwise" },
        { value: "counterclockwise", label: "Counterclockwise" },
      ],
      default: "clockwise",
    },
    fullCycle: {
      type: "easing",
      duration: 1,
      ease: [0, 0, 1, 1],
    },
  },
  geometry: {
    _collapsed: true,
    shape: {
      type: "select",
      options: [
        { value: "ellipse", label: "Ellipse" },
        { value: "custom-path", label: "Custom path" },
        { value: "parametric", label: "Parametric" },
        { value: "sphere", label: "Sphere" },
        { value: "deck", label: "Deck" },
        { value: "shuffle", label: "Shuffle" },
        { value: "tunnel", label: "Tunnel" },
        { value: "cylinder", label: "Cylinder" },
        { value: "racetrack", label: "Racetrack" },
        { value: "focus-deck", label: "Focus deck" },
        { value: "fan", label: "Fan" },
        { value: "pendulum", label: "Pendulum" },
        { value: "vortex", label: "Vortex" },
      ],
      default: "parametric",
    },
    customPath: {
      type: "text",
      default: "[[0.04,0.68],[0.22,0.36],[0.48,0.48],[0.72,0.68],[0.96,0.34]]",
    },
    dynamicScale: true,
    radiusX: [360, 0, 1200, 10],
    radiusY: [160, 0, 800, 10],
    circleRotation: [0, -180, 180, 1],
    depth: [260, 0, 800, 10],
    tilt: [28, -90, 90, 1],
    turns: [1, 0.25, 4, 0.25],
    rotation: [0, -180, 180, 1],
    orient3d: true,
    xWave: {
      type: "select",
      options: [{ value: "cos", label: "Cosine" }, { value: "sin", label: "Sine" }],
      default: "cos",
    },
    yWave: {
      type: "select",
      options: [{ value: "sin", label: "Sine" }, { value: "cos", label: "Cosine" }],
      default: "sin",
    },
    depthWave: {
      type: "select",
      options: [{ value: "sin", label: "Sine" }, { value: "cos", label: "Cosine" }],
      default: "sin",
    },
    xFrequency: [1, 0, 8, 0.25],
    yFrequency: [1, 0, 8, 0.25],
    depthFrequency: [1, 0, 8, 0.25],
    xAmplitude: [1, -2, 2, 0.05],
    yAmplitude: [1, -2, 2, 0.05],
    depthAmplitude: [1, -2, 2, 0.05],
    xPhase: [0, -180, 180, 1],
    yPhase: [0, -180, 180, 1],
    depthPhase: [0, -180, 180, 1],
    yOffset: [0, -2, 2, 0.05],
    shapeAmount: [1, 0, 2, 0.05],
    itemSpread: [1, 0, 3, 0.05],
    depthFalloff: [1, 0.1, 4, 0.05],
  },
  appearance: {
    _collapsed: true,
    nearScale: [1.25, 0.1, 3, 0.05],
    farScale: [0.55, 0.05, 2, 0.05],
    farOpacity: [0.28, 0, 1, 0.01],
    fadeStart: [0, 0, 100, 1],
    fadeEnd: [100, 0, 100, 1],
    opacityCurve: {
      type: "select",
      options: [
        { value: "linear", label: "Linear" },
        { value: "early", label: "Early fade" },
        { value: "late", label: "Late fade" },
        { value: "soft", label: "Soft" },
        { value: "sharp", label: "Sharp" },
      ],
      default: "linear",
    },
    facePath: false,
  },
  other: {
    _collapsed: true,
    centerBeforeApply: true,
    depthSplit: true,
    scope: {
      type: "select",
      options: [
        { value: "selection", label: "Selected layers" },
        { value: "children", label: "Frame children" },
        { value: "deep", label: "Deep descendants" },
      ],
      default: "selection",
    },
    resetSettings: {
      type: "action",
      label: "Reset settings",
    },
  },
} satisfies DialConfig;

const panelId = "orbit-motion-controls-v6";

const builtInPresetSchemaKey = "orbit-built-in-preset-schema";
const builtInPresetSchemaVersion = "5";
let builtInPresetSchemaMigratedInSession = false;

function shouldMigrateBuiltInPresets(): boolean {
  if (builtInPresetSchemaMigratedInSession) return false;
  try {
    return window.localStorage.getItem(builtInPresetSchemaKey) !== builtInPresetSchemaVersion;
  } catch {
    return true;
  }
}

function markBuiltInPresetsMigrated(): void {
  builtInPresetSchemaMigratedInSession = true;
  try {
    window.localStorage.setItem(builtInPresetSchemaKey, builtInPresetSchemaVersion);
  } catch {
    // The preset catalog remains usable when Figma disables iframe storage.
  }
}

function applyBuiltInPresetTuning(preset: PresetId): void {
  DialStore.updateValue(panelId, "preset", preset);
  const tuning = builtInPresetTunings[preset];
  for (const [key, value] of Object.entries(tuning.geometry ?? {})) {
    DialStore.updateValue(panelId, `geometry.${key}`, value as number | string | boolean);
  }
  for (const [key, value] of Object.entries(tuning.appearance ?? {})) {
    DialStore.updateValue(panelId, `appearance.${key}`, value as number | string | boolean);
  }
}

const libraryLinks = [
  { label: "DialKit · MIT", href: "https://www.dialkit.dev/" },
  { label: "React · MIT", href: "https://react.dev/" },
  { label: "Motion · MIT", href: "https://motion.dev/" },
] as const;

const cycleEasingPresets = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
} as const;

interface SavedEasingPreset {
  id: string;
  name: string;
  ease: [number, number, number, number];
}

const easingStorageKey = "orbit-motion-easing-presets";
const builtInEasings: SavedEasingPreset[] = Object.entries(cycleEasingPresets).map(
  ([id, ease]) => ({
    id,
    name: id === "easeInOut" ? "Ease in out" : id === "easeIn" ? "Ease in" : id === "easeOut" ? "Ease out" : "Linear",
    ease: [...ease],
  }),
);

function readSavedEasings(): SavedEasingPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(easingStorageKey) ?? "[]") as SavedEasingPreset[];
    return parsed.filter((preset) => (
      typeof preset.id === "string" && typeof preset.name === "string" &&
      Array.isArray(preset.ease) && preset.ease.length === 4
    ));
  } catch {
    return [];
  }
}

function writeSavedEasings(presets: SavedEasingPreset[]): void {
  try {
    window.localStorage.setItem(easingStorageKey, JSON.stringify(presets));
  } catch {
    // Presets remain available for the current session when storage is unavailable.
  }
}

function EasingPresetManager({ transition }: { transition: DialTransition }) {
  const [saved, setSaved] = useState(readSavedEasings);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const ease = transition.type === "easing" && Array.isArray(transition.ease)
    ? transition.ease
    : cycleEasingPresets.linear;
  const presets = [...saved, ...builtInEasings];
  const matching = presets.find((preset) => preset.ease.every((value, index) => value === ease[index]));
  const selectedId = matching?.id ?? "custom";

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const applyPreset = (id: string) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    DialStore.updateValue(panelId, "motion.fullCycle", {
      type: "easing",
      duration: transition.type === "easing" ? transition.duration ?? 1 : 1,
      ease: [...preset.ease],
    });
    setOpen(false);
  };
  const savePreset = () => {
    const usedNames = new Set(presets.map((preset) => preset.name));
    let suffix = saved.length + 1;
    while (usedNames.has(`Easing ${suffix}`)) suffix += 1;
    const next = [{
      id: `custom-${Date.now()}`,
      name: `Easing ${suffix}`,
      ease: [...ease] as [number, number, number, number],
    }, ...saved];
    setSaved(next);
    writeSavedEasings(next);
  };
  const deletePreset = (id: string) => {
    const next = saved.filter((preset) => preset.id !== id);
    setSaved(next);
    writeSavedEasings(next);
    if (selectedId === id) applyPreset("linear");
  };

  const toggleOpen = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen((current) => !current);
  };

  return (
    <div className="dialkit-panel-toolbar orbit-easing-toolbar">
      <button className="dialkit-toolbar-add" type="button" onClick={savePreset} title="Add easing preset" aria-label="Add easing preset">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <div className="dialkit-preset-manager">
        <button ref={triggerRef} className="dialkit-preset-trigger" type="button" onClick={toggleOpen} data-open={String(open)} aria-haspopup="menu" aria-expanded={open} aria-label="Easing presets">
          <span className="dialkit-preset-label">{matching?.name ?? "Custom"}</span>
          <svg className="dialkit-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 9 5 5 5-5" /></svg>
        </button>
        {open && createPortal(
          <div ref={dropdownRef} className="dialkit-root dialkit-preset-dropdown" role="menu" style={{ position: "fixed", top: position.top, left: position.left, minWidth: position.width }}>
            {presets.map((preset) => {
              const deletable = preset.id.startsWith("custom-");
              return (
                <div className="dialkit-preset-item" data-active={String(preset.id === selectedId)} key={preset.id} onClick={() => applyPreset(preset.id)}>
                  <button className="dialkit-preset-name" type="button">{preset.name}</button>
                  {deletable && (
                    <button className="dialkit-preset-delete" type="button" title={`Delete ${preset.name}`} onClick={(event) => { event.stopPropagation(); deletePreset(preset.id); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6" /></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

function parsePathPoints(value: string): Array<[number, number]> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((point): point is [number, number] => (
      Array.isArray(point) && point.length === 2 &&
      typeof point[0] === "number" && typeof point[1] === "number"
    ));
  } catch {
    return [];
  }
}

function GeometryPathEditor({ settings, target }: { settings: MotionSettings; target: TargetPreview }) {
  const [points, setPoints] = useState<Array<[number, number]>>(
    () => parsePathPoints(settings.geometry.customPath),
  );
  const drawing = useRef(false);
  const draft = useRef<Array<[number, number]>>(points);
  const activeHandle = useRef<"x" | "y" | "rotation" | "tilt" | null>(null);
  const editorRef = useRef<SVGSVGElement>(null);
  const frameWidth = target.frameWidth || 720;
  const frameHeight = target.frameHeight || 400;
  const { width: viewWidth, height: viewHeight } = fitPreviewFrame(frameWidth, frameHeight, 328, 240);
  const source = target.items[0] ?? { width: 80, height: 100, offsetX: 0, offsetY: 0 };
  const fitted = fitSettingsToFrame(
    settings,
    frameWidth,
    frameHeight,
    source.width,
    source.height,
  );
  const radiusX = fitted.geometry.radiusX / frameWidth * viewWidth;
  const radiusY = fitted.geometry.radiusY / frameHeight * viewHeight;
  const circleRotation = settings.geometry.circleRotation ?? 0;
  const orbitOrientation = supportsOrbitOrientation(settings.geometry);
  const renderOrbitPreview = orbitOrientation && settings.geometry.shape !== "custom-path";
  const orbitPathCount = settings.geometry.shape === "sphere"
    ? Math.min(Math.max(target.count || 9, 2), 24)
    : 1;
  const orbitPreviewPaths = renderOrbitPreview
    ? Array.from({ length: orbitPathCount }, (_, index) => {
        const frames = generateNodeKeyframes({
          ...fitted,
          motion: {
            ...fitted.motion,
            keyframes: 48,
            fullCycle: { type: "easing", duration: 1, ease: [0, 0, 1, 1] },
          },
        }, index, orbitPathCount);
        const scale = viewWidth / frameWidth;
        return frames.map((frame) => (
          `${viewWidth / 2 + frame.x * scale},${viewHeight / 2 + frame.y * scale}`
        )).join(" ");
      })
    : [];
  const centerX = viewWidth / 2;
  const centerY = viewHeight / 2;
  const orbitRotationRadians = circleRotation * Math.PI / 180;
  const orientationRadius = Math.max(28, Math.min(viewWidth, viewHeight) / 2 - 14);
  const rotationHandle = {
    x: centerX + Math.cos(orbitRotationRadians) * orientationRadius,
    y: centerY + Math.sin(orbitRotationRadians) * orientationRadius,
  };
  const tiltTravel = Math.max(20, Math.min(56, viewHeight / 2 - 16));
  const tiltGuideX = 14;
  const tiltHandleY = centerY - (settings.geometry.tilt / 90) * tiltTravel;

  useEffect(() => {
    if (!drawing.current) {
      const next = parsePathPoints(settings.geometry.customPath);
      setPoints(next);
      draft.current = next;
    }
  }, [settings.geometry.customPath]);

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const bounds = editorRef.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    ];
  };
  const start = (event: React.PointerEvent<SVGSVGElement>) => {
    if (settings.geometry.shape !== "custom-path") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    draft.current = [pointFromEvent(event)];
    setPoints(draft.current);
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activeHandle.current) {
      const bounds = editorRef.current!.getBoundingClientRect();
      const dx = event.clientX - bounds.left - bounds.width / 2;
      const dy = event.clientY - bounds.top - bounds.height / 2;
      if (activeHandle.current === "rotation") {
        const degrees = Math.atan2(dy, dx) * 180 / Math.PI;
        DialStore.updateValue(panelId, "geometry.circleRotation", Math.round(degrees));
        return;
      }
      if (activeHandle.current === "tilt") {
        const dyInViewBox = dy * viewHeight / bounds.height;
        const normalized = Math.min(1, Math.max(-1, -dyInViewBox / tiltTravel));
        DialStore.updateValue(panelId, "geometry.tilt", Math.round(normalized * 90));
        return;
      }
      const radians = -circleRotation * Math.PI / 180;
      const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
      const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
      if (activeHandle.current === "x") {
        const normalized = Math.abs(localX) / bounds.width;
        DialStore.updateValue(panelId, "geometry.radiusX", Math.round(normalized * frameWidth / 10) * 10);
      } else {
        const normalized = Math.abs(localY) / bounds.height;
        DialStore.updateValue(panelId, "geometry.radiusY", Math.round(normalized * frameHeight / 10) * 10);
      }
      return;
    }
    if (!drawing.current) return;
    const point = pointFromEvent(event);
    const last = draft.current[draft.current.length - 1];
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.015) return;
    draft.current = [...draft.current, point].slice(-96);
    setPoints(draft.current);
  };
  const finish = () => {
    activeHandle.current = null;
    if (!drawing.current) return;
    drawing.current = false;
    if (draft.current.length >= 2) {
      DialStore.updateValue(panelId, "geometry.customPath", JSON.stringify(draft.current));
    }
  };
  const startHandle = (
    event: React.PointerEvent<SVGCircleElement>,
    handle: "x" | "y" | "rotation" | "tilt",
  ) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeHandle.current = handle;
  };
  const polyline = points.map(([x, y]) => `${x * viewWidth},${y * viewHeight}`).join(" ");
  const pathIsClosed = points.length > 2 && Math.hypot(
    points[0][0] - points[points.length - 1][0],
    points[0][1] - points[points.length - 1][1],
  ) < 0.001;

  return (
    <div className="orbit-path-controls">
    <svg ref={editorRef} className={`orbit-path-editor ${renderOrbitPreview ? "orbit-path-editor-preview" : ""}`} style={{ width: `${viewWidth}px` }} viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={renderOrbitPreview ? "3D trajectory preview" : settings.geometry.shape === "custom-path" ? pathIsClosed ? "Edit a closed motion path" : "Draw an open motion path" : settings.geometry.dynamicScale ? "Ellipse fitted automatically to the selected frame" : "Adjust ellipse width and height"} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <rect width={viewWidth} height={viewHeight} rx="10" />
      <path className="orbit-path-grid" d={`M${centerX} 0V${viewHeight}M0 ${centerY}H${viewWidth}`} />
      {renderOrbitPreview ? orbitPreviewPaths.map((previewPath, index) => (
        <polyline className="orbit-path-line orbit-path-line-preview" points={previewPath} key={index} />
      )) : settings.geometry.shape === "ellipse" ? (
        <g transform={`rotate(${circleRotation} ${centerX} ${centerY})`}>
          <ellipse className="orbit-path-line" cx={centerX} cy={centerY} rx={radiusX} ry={radiusY} />
          {!settings.geometry.dynamicScale && <circle className="orbit-path-handle" cx={centerX + radiusX} cy={centerY} r="6" onPointerDown={(event) => startHandle(event, "x")} />}
          {!settings.geometry.dynamicScale && <circle className="orbit-path-handle" cx={centerX} cy={centerY + radiusY} r="6" onPointerDown={(event) => startHandle(event, "y")} />}
        </g>
      ) : points.length > 1 ? <polyline className="orbit-path-line" points={polyline} /> : null}
      {orbitOrientation && (
        <g className="orbit-orientation-handles">
          {!settings.geometry.dynamicScale && (
            <g transform={`rotate(${circleRotation} ${centerX} ${centerY})`}>
              <circle className="orbit-path-handle" cx={centerX + radiusX} cy={centerY} r="6" aria-label="Adjust orbit width" onPointerDown={(event) => startHandle(event, "x")} />
              <circle className="orbit-path-handle" cx={centerX} cy={centerY + radiusY} r="6" aria-label="Adjust orbit height" onPointerDown={(event) => startHandle(event, "y")} />
            </g>
          )}
          <line className="orbit-handle-guide" x1={centerX} y1={centerY} x2={rotationHandle.x} y2={rotationHandle.y} />
          <circle className="orbit-path-handle orbit-rotation-handle" cx={rotationHandle.x} cy={rotationHandle.y} r="6" aria-label="Rotate orbit" onPointerDown={(event) => startHandle(event, "rotation")} />
          <line className="orbit-handle-guide" x1={tiltGuideX} y1={centerY - tiltTravel} x2={tiltGuideX} y2={centerY + tiltTravel} />
          <circle className="orbit-path-handle orbit-tilt-handle" cx={tiltGuideX} cy={tiltHandleY} r="6" aria-label="Tilt orbit" onPointerDown={(event) => startHandle(event, "tilt")} />
        </g>
      )}
    </svg>
    </div>
  );
}

function send(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function usePreviewTime(duration: number): number {
  const [time, setTime] = useState(0);
  const started = useRef(performance.now());

  useEffect(() => {
    let frame = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setTime(duration * 0.16);
      return undefined;
    }
    started.current = performance.now();
    const tick = (now: number) => {
      setTime(((now - started.current) / 1000) % Math.max(duration, 0.1));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration]);

  return time;
}

function readFigmaTheme(): "light" | "dark" {
  if (document.body.classList.contains("figma-light")) return "light";
  if (document.body.classList.contains("figma-dark")) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function useFigmaTheme(): "light" | "dark" {
  const [theme, setTheme] = useState(readFigmaTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setTheme(readFigmaTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  return theme;
}

function OrbitPreview({
  settings,
  target,
}: {
  settings: MotionSettings;
  target: TargetPreview;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 328, height: 180 });
  const [pinned, setPinned] = useState(() => {
    try {
      return window.localStorage.getItem("orbit-motion-preview-pinned") === "true";
    } catch {
      return false;
    }
  });
  const time = usePreviewTime(settings.motion.duration);
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return undefined;
    const updateSize = () => {
      setPreviewSize({ width: element.clientWidth, height: element.clientHeight });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const itemCount = target.count > 0 ? target.count : 9;
  const drawCount = Math.min(itemCount, 18);
  const previewScale = target.frameWidth > 0 && target.frameHeight > 0
    ? Math.min(
        Math.max(previewSize.width - 24, 1) / target.frameWidth,
        Math.max(previewSize.height - 24, 1) / target.frameHeight,
      )
    : 0.22;
  const cards = Array.from({ length: drawCount }, (_, previewIndex) => {
    const index = itemCount <= drawCount
      ? previewIndex
      : Math.floor((previewIndex / drawCount) * itemCount);
    const sourceSize = target.items[previewIndex] ?? {
      width: 3,
      height: 4,
      offsetX: 0,
      offsetY: 0,
    };
    const fittedSettings = fitSettingsToFrame(
      settings,
      target.frameWidth,
      target.frameHeight,
      sourceSize.width,
      sourceSize.height,
    );
    const frames = generateNodeKeyframes(fittedSettings, index, itemCount);
    const width = Math.max(1, sourceSize.width * previewScale);
    const height = Math.max(1, sourceSize.height * previewScale);
    const layers = settings.other.depthSplit ? (["back", "front"] as const) : (["single"] as const);
    return layers.map((layer) => {
      const layerFrames = layer === "single"
        ? frames
        : frames.map((frame) => ({
            ...frame,
            opacity: depthSplitOpacity(frame, layer),
          }));
      const point = sampleGeneratedKeyframes(
        layerFrames,
        time,
        // Full-cycle timing is already baked into generateNodeKeyframes.
        // Interpolating those samples with it again would double-apply easing.
        { type: "easing", duration: 1, ease: [0, 0, 1, 1] },
      );
      return {
        index,
        layer,
        point,
        width,
        height,
        offsetX: sourceSize.offsetX,
        offsetY: sourceSize.offsetY,
      };
    });
  }).flat();

  const togglePinned = () => {
    setPinned((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("orbit-motion-preview-pinned", String(next));
      } catch {
        // Sticky preview still works when storage is unavailable.
      }
      return next;
    });
  };

  return (
    <div
      ref={previewRef}
      className={`preview ${pinned ? "pinned" : ""}`}
      aria-label="Live animation preview"
    >
      <div className="preview-grid" />
      <div className="preview-origin" />
      {cards.map(({ index, layer, point, width, height, offsetX, offsetY }) => (
        <div
          className={`preview-card preview-card-${index % 5}`}
          key={`${layer}-${index}`}
          style={{
            width,
            height,
            marginLeft: -width / 2,
            marginTop: -height / 2,
            opacity: point.opacity,
            zIndex: (layer === "front" ? drawCount : 0) + index,
            transform: `translate3d(${(point.x + (settings.other.centerBeforeApply ? 0 : offsetX)) * previewScale}px, ${(point.y + (settings.other.centerBeforeApply ? 0 : offsetY)) * previewScale}px, 0) rotate(${point.rotation}deg) scale(${point.scaleX}, ${point.scaleY})`,
          }}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
        </div>
      ))}
      <button
        className="dialkit-root dialkit-toolbar-add preview-pin"
        type="button"
        aria-label={pinned ? "Unpin preview" : "Pin preview"}
        aria-pressed={pinned}
        title={pinned ? "Unpin preview" : "Pin preview while scrolling"}
        onClick={togglePinned}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 17v5M5 17h14M6 17l1-5 2-2V5L7 3h10l-2 2v5l2 2 1 5H6Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

const windowHeightKey = "orbit-motion-window-height";
const minWindowHeight = 420;
const maxWindowHeight = 960;

function readSavedWindowHeight(): number | null {
  try {
    const saved = Number(window.localStorage.getItem(windowHeightKey));
    return Number.isFinite(saved) && saved >= minWindowHeight && saved <= maxWindowHeight
      ? saved
      : null;
  } catch {
    return null;
  }
}

function saveWindowHeight(height: number): void {
  try {
    window.localStorage.setItem(windowHeightKey, String(height));
  } catch {
    // Figma may disable storage for a sandboxed plugin UI. Resizing still works.
  }
}

function ResizeHandle() {
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState(() => window.innerHeight);
  const dragStart = useRef({ screenY: 0, height: window.innerHeight });
  const pendingFrame = useRef(0);
  const pendingHeight = useRef(window.innerHeight);

  const resize = useCallback((nextHeight: number) => {
    const clamped = Math.round(
      Math.min(maxWindowHeight, Math.max(minWindowHeight, nextHeight)),
    );
    setHeight(clamped);
    pendingHeight.current = clamped;
    saveWindowHeight(clamped);

    if (pendingFrame.current) return;
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = 0;
      send({ type: "resize", height: pendingHeight.current });
    });
  }, []);

  useEffect(() => {
    const saved = readSavedWindowHeight();
    if (saved !== null) resize(saved);
    return () => {
      if (pendingFrame.current) cancelAnimationFrame(pendingFrame.current);
    };
  }, [resize]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { screenY: event.screenY, height: window.innerHeight };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    resize(dragStart.current.height + event.screenY - dragStart.current.screenY);
  };

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    resize(height + (event.key === "ArrowDown" ? 40 : -40));
  };

  return (
    <div
      className={`resize-handle ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-label="Resize plugin height"
      aria-orientation="horizontal"
      aria-valuemin={minWindowHeight}
      aria-valuemax={maxWindowHeight}
      aria-valuenow={height}
      tabIndex={0}
      title="Drag to resize · Arrow keys change height"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={onKeyDown}
    >
      <span className="resize-grip" />
    </div>
  );
}

function OverlayScrollbar() {
  const [state, setState] = useState({ visible: false, scrollable: false, top: 0, height: 36 });
  const metrics = useRef({ maxScroll: 0, maxThumbTop: 0 });
  const drag = useRef({ active: false, y: 0, scrollY: 0 });
  const hideTimer = useRef(0);

  const update = useCallback((show: boolean) => {
    const root = document.documentElement;
    const trackHeight = Math.max(0, window.innerHeight - 18);
    const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
    const height = Math.max(36, trackHeight * (window.innerHeight / Math.max(root.scrollHeight, 1)));
    const maxThumbTop = Math.max(0, trackHeight - height);
    const top = maxScroll > 0 ? (window.scrollY / maxScroll) * maxThumbTop : 0;
    metrics.current = { maxScroll, maxThumbTop };
    setState((current) => ({
      visible: show ? true : current.visible,
      scrollable: maxScroll > 1,
      top,
      height,
    }));
  }, []);

  const showTemporarily = useCallback(() => {
    update(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!drag.current.active) {
        setState((current) => ({ ...current, visible: false }));
      }
    }, 700);
  }, [update]);

  useEffect(() => {
    const onResize = () => update(false);
    const sizeObserver = new ResizeObserver(onResize);
    sizeObserver.observe(document.body);
    window.addEventListener("scroll", showTemporarily, { passive: true });
    window.addEventListener("wheel", showTemporarily, { passive: true });
    window.addEventListener("resize", onResize);
    const frame = requestAnimationFrame(() => update(false));
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(hideTimer.current);
      sizeObserver.disconnect();
      window.removeEventListener("scroll", showTemporarily);
      window.removeEventListener("wheel", showTemporarily);
      window.removeEventListener("resize", onResize);
    };
  }, [showTemporarily, update]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { active: true, y: event.clientY, scrollY: window.scrollY };
    window.clearTimeout(hideTimer.current);
    setState((current) => ({ ...current, visible: true }));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    const ratio = metrics.current.maxScroll / Math.max(metrics.current.maxThumbTop, 1);
    window.scrollTo(0, drag.current.scrollY + (event.clientY - drag.current.y) * ratio);
  };

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current.active = false;
    showTemporarily();
  };

  if (!state.scrollable) return null;

  return (
    <div className={`overlay-scrollbar ${state.visible ? "visible" : ""}`} aria-hidden="true">
      <div
        className="overlay-scrollbar-thumb"
        style={{ height: state.height, transform: `translateY(${state.top}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      />
    </div>
  );
}

function App() {
  const theme = useFigmaTheme();
  const [selection, setSelection] = useState<SelectionSummary>({
    selected: 0,
    names: [],
    types: [],
    targets: {
      selection: { count: 0, orbitCount: 0, frameWidth: 0, frameHeight: 0, items: [] },
      children: { count: 0, orbitCount: 0, frameWidth: 0, frameHeight: 0, items: [] },
      deep: { count: 0, orbitCount: 0, frameWidth: 0, frameHeight: 0, items: [] },
    },
  });
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [easingPortalHost, setEasingPortalHost] = useState<HTMLElement | null>(null);
  const [pathPortalHost, setPathPortalHost] = useState<HTMLElement | null>(null);

  const resetSettings = useCallback(() => {
    setStatus(null);
    DialStore.resetValues(panelId);
    const defaults = DialStore.getValues(panelId);
    const turntable = DialStore.getPresets(panelId).find(
      (preset) => preset.name === "3D · Turntable",
    );
    if (turntable) DialStore.loadPreset(panelId, turntable.id);
    DialStore.updateValues(panelId, defaults);
  }, []);

  const values = useDialKit("Orbit Animator", controls, {
    id: panelId,
    persist: true,
    onAction: (action) => {
      if (action === "other.resetSettings") resetSettings();
    },
  }) as unknown as MotionSettings;

  useEffect(() => {
    const storedPresets = DialStore.getPresets(panelId);
    const storedActiveId = DialStore.getActivePresetId(panelId);
    const activePresetName = storedPresets.find((preset) => preset.id === storedActiveId)?.name;
    const builtInNames = new Set(presetOptions.map((preset) => preset.label));
    const migrateBuiltIns = shouldMigrateBuiltInPresets();
    const obsoletePresets = storedPresets.filter((preset) => (
      preset.name === "Album Wall" || (migrateBuiltIns && builtInNames.has(preset.name as typeof presetOptions[number]["label"]))
    ));
    const removedActivePreset = obsoletePresets.some(
      (preset) => preset.id === storedActiveId,
    );
    for (const preset of obsoletePresets) {
      DialStore.deletePreset(panelId, preset.id);
    }

    const existingPresets = DialStore.getPresets(panelId);
    const previousValues = { ...DialStore.getValues(panelId) };
    const previousActiveId = removedActivePreset ? null : storedActiveId;
    const knownNames = new Set(existingPresets.map((preset) => preset.name));
    let defaultPresetId = existingPresets.find(
      (preset) => preset.name === "3D · Turntable",
    )?.id ?? "";

    for (const preset of presetOptions) {
      if (knownNames.has(preset.label)) continue;
      DialStore.resetValues(panelId);
      applyBuiltInPresetTuning(preset.value);
      const presetId = DialStore.savePreset(panelId, preset.label);
      if (preset.value === "orbit-3d-ring") defaultPresetId = presetId;
    }

    if (migrateBuiltIns) markBuiltInPresetsMigrated();

    const migratedActivePresetId = removedActivePreset && activePresetName
      ? DialStore.getPresets(panelId).find((preset) => preset.name === activePresetName)?.id
      : undefined;
    if (migratedActivePresetId) {
      DialStore.loadPreset(panelId, migratedActivePresetId);
    } else if ((existingPresets.length === 0 || removedActivePreset) && defaultPresetId) {
      DialStore.loadPreset(panelId, defaultPresetId);
    } else if (
      previousActiveId &&
      DialStore.getPresets(panelId).some((preset) => preset.id === previousActiveId)
    ) {
      DialStore.loadPreset(panelId, previousActiveId);
    } else {
      DialStore.clearActivePreset(panelId);
      DialStore.updateValues(panelId, previousValues);
    }

    for (const path of ["motion.fullCycle"] as const) {
      const transition = DialStore.getValues(panelId)[path] as DialTransition | undefined;
      if (transition?.type === "spring") {
        DialStore.updateValue(panelId, path, {
          type: "easing",
          duration: 1,
          ease: [0, 0, 1, 1],
        });
      }
    }

    const updateDialKitUi = () => {
      document.querySelectorAll<HTMLElement>(".dialkit-select-row").forEach((row) => {
        const label = row.querySelector(".dialkit-select-label")?.textContent?.trim();
        row.classList.toggle("orbit-hidden-preset", label === "Preset");
      });
      document.querySelectorAll<HTMLElement>(".dialkit-preset-item").forEach((item) => {
        const name = item.querySelector(".dialkit-preset-name")?.textContent?.trim();
        item.classList.toggle("orbit-hidden-base-preset", name === "Version 1");
      });
      document.querySelectorAll<HTMLButtonElement>(".dialkit-segmented-button").forEach((button) => {
        const label = button.textContent?.trim();
        button.classList.toggle(
          "orbit-hidden-transition-mode",
          label === "Time" || label === "Physics",
        );
      });

      const transitionFolders = Array.from(
        document.querySelectorAll<HTMLElement>(".dialkit-folder:not(.dialkit-folder-root)"),
      );
      const fullCycleFolder = transitionFolders.find((folder) => (
        folder.querySelector<HTMLElement>(".dialkit-folder-title")?.textContent?.trim() ===
        "Full Cycle"
      ));
      const geometryFolder = transitionFolders.find((folder) => (
        folder.querySelector<HTMLElement>(".dialkit-folder-title")?.textContent?.trim() ===
        "Geometry"
      ));

      for (const folder of [fullCycleFolder]) {
        const typeRow = Array.from(
          folder?.querySelectorAll<HTMLElement>(".dialkit-labeled-control") ?? [],
        ).find((row) => (
          row.querySelector<HTMLElement>(".dialkit-labeled-control-label")?.textContent?.trim() ===
          "Type"
        ));
        if (typeRow) typeRow.classList.add("orbit-transition-type-row");
        if (folder === fullCycleFolder) typeRow?.classList.add("orbit-hidden-transition-type");
        const durationRow = Array.from(
          folder?.querySelectorAll<HTMLElement>(".dialkit-slider-wrapper") ?? [],
        ).find((row) => (
          row.querySelector<HTMLElement>(".dialkit-slider-label")?.textContent?.trim() ===
          "Duration"
        ));
        durationRow?.classList.add("orbit-hidden-transition-duration");
      }
      document.querySelectorAll<HTMLElement>(".dialkit-text-control").forEach((row) => {
        const label = row.querySelector<HTMLElement>(".dialkit-text-label")
          ?.textContent?.trim();
        if (label === "Custom Path") row.classList.add("orbit-hidden-custom-path");
      });
      document.querySelectorAll<HTMLElement>(".dialkit-labeled-control-label").forEach((label) => {
        if (label.textContent?.trim() === "Orient3d") label.textContent = "3D orientation";
      });


      const fullCycleContent = fullCycleFolder?.querySelector<HTMLElement>(".dialkit-folder-inner > div");
      if (fullCycleContent) {
        fullCycleFolder?.classList.add("orbit-inline-transition-folder");
        let host = fullCycleContent.querySelector<HTMLElement>(":scope > .orbit-easing-portal");
        if (!host) {
          host = document.createElement("div");
          host.className = "orbit-easing-portal";
          fullCycleContent.prepend(host);
        }
        setEasingPortalHost((current) => current === host ? current : host);
      }

      const shapeRow = Array.from(
        geometryFolder?.querySelectorAll<HTMLElement>(".dialkit-select-row") ?? [],
      ).find((row) => row.querySelector(".dialkit-select-label")?.textContent?.trim() === "Shape");
      if (shapeRow) {
        let host = shapeRow.nextElementSibling as HTMLElement | null;
        if (!host?.classList.contains("orbit-path-portal")) {
          host = document.createElement("div");
          host.className = "orbit-path-portal";
          shapeRow.after(host);
        }
        setPathPortalHost((current) => current === host ? current : host);
      }

      const otherFolder = Array.from(
        document.querySelectorAll<HTMLElement>(".dialkit-folder:not(.dialkit-folder-root)"),
      ).find((folder) => (
        folder.querySelector<HTMLElement>(".dialkit-folder-title")?.textContent?.trim() === "Other"
      ));
      const folderInner = otherFolder?.querySelector<HTMLElement>(".dialkit-folder-inner");
      if (folderInner && !folderInner.querySelector(".orbit-library-links")) {
        const links = document.createElement("div");
        links.className = "orbit-library-links";
        links.setAttribute("aria-label", "Open source libraries");
        for (const library of libraryLinks) {
          const anchor = document.createElement("a");
          anchor.href = library.href;
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          anchor.textContent = library.label;
          links.append(anchor);
        }
        folderInner.append(links);
      }
    };
    updateDialKitUi();
    const observer = new MutationObserver(updateDialKitUi);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const disabled = values.geometry.dynamicScale;
    const parametric = values.geometry.shape === "parametric";
    const depthWave = parametric || values.geometry.shape === "ellipse" ||
      values.geometry.shape === "custom-path";
    const shapeAmount = ["deck", "shuffle", "tunnel", "cylinder", "racetrack", "fan", "pendulum", "vortex", "focus-deck"]
      .includes(values.geometry.shape);
    const itemSpread = ["deck", "shuffle", "cylinder", "fan", "pendulum", "focus-deck"]
      .includes(values.geometry.shape);
    const depthFalloff = values.geometry.shape === "deck" || values.geometry.shape === "focus-deck";
    document.querySelectorAll<HTMLElement>(".dialkit-select-row").forEach((row) => {
      const label = row.querySelector<HTMLElement>(".dialkit-select-label")?.textContent?.trim();
      if (label === "X Wave" || label === "Y Wave") {
        row.classList.toggle("orbit-control-hidden", !parametric);
      } else if (label === "Depth Wave") {
        row.classList.toggle("orbit-control-hidden", !depthWave);
      }
    });
    document.querySelectorAll<HTMLElement>(".dialkit-slider-wrapper").forEach((wrapper) => {
      const label = wrapper.querySelector<HTMLElement>(".dialkit-slider-label")?.textContent?.trim();
      if (["X Frequency", "Y Frequency", "X Amplitude", "Y Amplitude", "X Phase", "Y Phase", "Y Offset"].includes(label ?? "")) {
        wrapper.classList.toggle("orbit-control-hidden", !parametric);
        return;
      }
      if (["Depth Frequency", "Depth Amplitude", "Depth Phase"].includes(label ?? "")) {
        wrapper.classList.toggle("orbit-control-hidden", !depthWave);
        return;
      }
      if (label === "Shape Amount") {
        wrapper.classList.toggle("orbit-control-hidden", !shapeAmount);
        return;
      }
      if (label === "Item Spread") {
        wrapper.classList.toggle("orbit-control-hidden", !itemSpread);
        return;
      }
      if (label === "Depth Falloff") {
        wrapper.classList.toggle("orbit-control-hidden", !depthFalloff);
        return;
      }
      if (label === "Tilt") {
        wrapper.classList.toggle("orbit-control-hidden", !values.geometry.orient3d);
        return;
      }
      if (label === "Circle Rotation" || label === "Orbit Rotation") {
        const labelElement = wrapper.querySelector<HTMLElement>(".dialkit-slider-label");
        const orbitOrientation = supportsOrbitOrientation(values.geometry);
        const nextLabel = orbitOrientation ? "Orbit Rotation" : "Circle Rotation";
        if (labelElement && labelElement.textContent !== nextLabel) labelElement.textContent = nextLabel;
        wrapper.querySelector<HTMLElement>('[role="slider"]')?.setAttribute("aria-label", nextLabel);
        wrapper.classList.toggle(
          "orbit-control-hidden",
          !orbitOrientation && (
            values.geometry.shape !== "ellipse"
          ),
        );
        return;
      }
      if (label === "Radius X" || label === "Radius Y") {
        wrapper.classList.toggle("orbit-radius-disabled", disabled);
        wrapper.inert = disabled;
        wrapper.setAttribute("aria-disabled", String(disabled));
        const slider = wrapper.querySelector<HTMLElement>('[role="slider"]');
        slider?.setAttribute("aria-disabled", String(disabled));
        if (disabled) slider?.setAttribute("tabindex", "-1");
        else slider?.setAttribute("tabindex", "0");
      }
    });
  }, [values.geometry.dynamicScale, values.geometry.shape, values.geometry.orient3d, pathPortalHost]);

  useEffect(() => {
    window.onmessage = (event: MessageEvent<{ pluginMessage?: PluginToUiMessage }>) => {
      const message = event.data.pluginMessage;
      if (!message) return;
      if (message.type === "selection") setSelection(message.selection);
      if (message.type === "result") {
        setStatus({ kind: message.kind, message: message.message });
      }
    };
    send({ type: "refresh-selection" });
    return () => {
      window.onmessage = null;
    };
  }, []);

  const activeTarget = selection.targets[values.other.scope];
  const hasOrbitMotion = activeTarget.orbitCount > 0;
  const canApply = activeTarget.count > 0;

  const applyMotion = () => {
    setStatus(null);
    send({ type: "apply", settings: values });
  };

  const clearMotion = () => {
    setStatus(null);
    send({ type: "clear", scope: values.other.scope });
  };

  return (
    <main>
      <OrbitPreview settings={values} target={selection.targets[values.other.scope]} />

      {status && <div className={`status ${status.kind}`}>{status.message}</div>}

      <section className="dial-panel">
        <DialRoot mode="inline" theme={theme} productionEnabled />
        {easingPortalHost && createPortal(
          <EasingPresetManager transition={values.motion.fullCycle} />,
          easingPortalHost,
        )}
        {pathPortalHost && (supportsPathGeometry(values.geometry.shape) || supportsOrbitOrientation(values.geometry)) && createPortal(
          <GeometryPathEditor settings={values} target={selection.targets[values.other.scope]} />,
          pathPortalHost,
        )}
      </section>

      <div className="dialkit-root bottom-actions" data-theme={theme}>
        <button
          className="dialkit-button"
          type="button"
          disabled={!hasOrbitMotion}
          onClick={clearMotion}
        >
          Clear
        </button>
        <button
          className="dialkit-button"
          type="button"
          disabled={!canApply}
          onClick={applyMotion}
        >
          {hasOrbitMotion ? "Refresh motion" : "Apply motion"}
        </button>
      </div>

      <OverlayScrollbar />
      <ResizeHandle />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
