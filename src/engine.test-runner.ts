import {
  depthSplitOpacity,
  fitPreviewFrame,
  fitSettingsToFrame,
  generateNodeKeyframes,
  pointForGeometry,
  sampleGeneratedKeyframes,
  supportsOrbitOrientation,
  supportsPathGeometry,
} from "./engine";
import { builtInPresetTunings } from "./presets";
import { presetOptions, type MotionSettings } from "./types";

const settings: MotionSettings = {
  preset: "orbit-3d-ring",
  motion: {
    duration: 3.2,
    stagger: 0.12,
    keyframes: 16,
    direction: "clockwise",
    fullCycle: { type: "easing", duration: 1, ease: [0, 0, 1, 1] },
  },
  geometry: {
    shape: "parametric",
    dynamicScale: true,
    customPath: "[[0.5,0],[1,0.5],[0.5,1],[0,0.5]]",
    radiusX: 360,
    radiusY: 160,
    circleRotation: 0,
    depth: 260,
    tilt: 28,
    turns: 1,
    rotation: 8,
    orient3d: true,
    xWave: "cos",
    yWave: "sin",
    depthWave: "sin",
    xFrequency: 1,
    yFrequency: 1,
    depthFrequency: 1,
    xAmplitude: 1,
    yAmplitude: 0.22,
    depthAmplitude: 1,
    xPhase: 0,
    yPhase: 0,
    depthPhase: 0,
    yOffset: 0,
    shapeAmount: 1,
    itemSpread: 1,
    depthFalloff: 1,
  },
  appearance: {
    nearScale: 1.25,
    farScale: 0.55,
    farOpacity: 0.28,
    fadeStart: 0,
    fadeEnd: 100,
    opacityCurve: "linear",
    facePath: false,
  },
  other: {
    centerBeforeApply: true,
    depthSplit: true,
    scope: "selection",
  },
};

function settingsForPreset(preset: typeof presetOptions[number]["value"]): MotionSettings {
  const tuning = builtInPresetTunings[preset];
  return {
    ...settings,
    preset,
    geometry: { ...settings.geometry, ...tuning.geometry },
    appearance: { ...settings.appearance, ...tuning.appearance },
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(presetOptions.length === 20, "Expected twenty presets");
assert(
  presetOptions.filter((preset) => preset.value.startsWith("orbit-3d")).length === 6,
  "Expected six 3D orbit presets",
);
assert(
  !presetOptions.some((preset) => String(preset.value) === "album-wall"),
  "Album Wall must not remain in the preset list",
);

const coverFlowPoint = pointForGeometry(Math.PI / 3, settingsForPreset("cover-flow"), 2, 9);
assert(coverFlowPoint.rotation === 0, "Cover Flow must not rotate layers");

const customPathStart = pointForGeometry(0, {
  ...settings,
  geometry: {
    ...settings.geometry,
    shape: "custom-path",
    customPath: "[[0,0.5],[0.5,0],[1,0.5],[0.5,1]]",
  },
});
assert(customPathStart.x < 0, "Curve mode must replace the preset X/Y path");
assert(
  supportsPathGeometry("ellipse") && supportsPathGeometry("custom-path"),
  "Ellipse and Custom Path must expose editable path geometry",
);
assert(
  !supportsPathGeometry("parametric") && !supportsPathGeometry("vortex"),
  "Other geometry shapes must not expose path drawing",
);
assert(
  supportsOrbitOrientation(settingsForPreset("orbit-3d-ring").geometry) &&
    supportsOrbitOrientation(settingsForPreset("orbit-3d-sphere").geometry) &&
    !supportsOrbitOrientation(settingsForPreset("fan").geometry),
  "3D orientation must be controlled by geometry settings",
);

const tiltedTurntable = pointForGeometry(Math.PI / 2, {
  ...settings,
  geometry: { ...settings.geometry, tilt: 45, circleRotation: 0 },
});
const flatTurntable = pointForGeometry(Math.PI / 2, {
  ...settings,
  geometry: { ...settings.geometry, tilt: 0, circleRotation: 0 },
});
assert(
  Math.abs(tiltedTurntable.y - flatTurntable.y) > 1 &&
    Math.abs(tiltedTurntable.z - flatTurntable.z) > 1,
  "Turntable tilt must rotate its orbit plane",
);
const rotatedTurntable = pointForGeometry(0, {
  ...settings,
  geometry: { ...settings.geometry, tilt: 0, circleRotation: 90 },
});
assert(
  Math.abs(rotatedTurntable.x) < 1e-6 &&
    Math.abs(rotatedTurntable.y - settings.geometry.radiusX) < 1e-6,
  "Turntable orbit rotation must rotate its path around the center",
);

const rotatedCircle = pointForGeometry(0, {
  ...settings,
  geometry: { ...settings.geometry, shape: "ellipse", orient3d: false, circleRotation: 90 },
});
assert(
  Math.abs(rotatedCircle.x) < 1e-6 && Math.abs(rotatedCircle.y - settings.geometry.radiusX) < 1e-6,
  "Circle rotation must rotate the path geometry around its center",
);

const waveDefaults = builtInPresetTunings["path-wave"].geometry;
const waveLoop = generateNodeKeyframes({
  ...settings,
  preset: "path-wave",
  geometry: { ...settings.geometry, ...waveDefaults },
}, 0, 1);
assert(
  waveDefaults.shape === "custom-path" && waveLoop[0].opacity === 0 && waveLoop.at(-1)!.opacity === 0,
  "Path Wave must default to an open path with hidden wraparound",
);

const racetrackDefaults = builtInPresetTunings.racetrack.geometry;
const racetrackLoop = generateNodeKeyframes({
  ...settings,
  preset: "racetrack",
  geometry: { ...settings.geometry, ...racetrackDefaults },
}, 0, 1);
assert(
  racetrackDefaults.shape === "custom-path" &&
    Math.abs(racetrackLoop[0].x - racetrackLoop.at(-1)!.x) < 1e-6 &&
    racetrackLoop[0].opacity > 0,
  "Racetrack must default to a closed visible path",
);

const openPathLoop = generateNodeKeyframes({
  ...settings,
  preset: "circle",
  geometry: {
    ...settings.geometry,
    shape: "custom-path",
    customPath: "[[0,0.5],[0.5,0.2],[1,0.5]]",
  },
}, 0, 1);
assert(
  openPathLoop[0].opacity === 0 && openPathLoop.at(-1)!.opacity === 0 &&
    openPathLoop[Math.floor(openPathLoop.length / 2)].opacity > 0,
  "Open paths must disappear at the end before returning to the start",
);

const fanLoopLeft = generateNodeKeyframes(settingsForPreset("fan"), 0, 9);
const fanLoopRight = generateNodeKeyframes(settingsForPreset("fan"), 8, 9);
assert(
  fanLoopLeft[8].rotation > 0 && fanLoopRight[8].rotation < 0,
  "Fan layers must tilt outward in the expected direction",
);
const reversedFan = generateNodeKeyframes({
  ...settingsForPreset("fan"),
  motion: { ...settings.motion, direction: "counterclockwise" },
}, 0, 9);
assert(
  Math.sign(reversedFan[8].x) === -Math.sign(fanLoopLeft[8].x) &&
    Math.sign(reversedFan[8].rotation) === -Math.sign(fanLoopLeft[8].rotation),
  "Fan direction must mirror its position and rotation",
);

const sphereSettings = settingsForPreset("orbit-3d-sphere");
const spherePoints = Array.from({ length: 9 }, (_, index) =>
  generateNodeKeyframes(sphereSettings, index, 9)[0]);
assert(
  new Set(spherePoints.map((point) => point.y.toFixed(3))).size === 9,
  "Sphere layers must be distributed across distinct latitudes",
);
const sphereRadius = Math.min(settings.geometry.radiusX, settings.geometry.radiusY);
const sphereDepth = sphereSettings.geometry.depth;
assert(
  spherePoints.every((point) => Math.abs(
    (point.x / sphereRadius) ** 2 +
    (point.y / sphereRadius) ** 2 +
    (point.z / sphereDepth) ** 2 - 1
  ) < 1e-6),
  "Every Sphere layer must lie on the same spherical surface",
);
const sphereLongitudes = spherePoints.map((point) => Math.atan2(
  point.z / sphereDepth,
  point.x / sphereRadius,
));
const longitudeSteps = sphereLongitudes.slice(1).map((longitude, index) => (
  ((longitude - sphereLongitudes[index]) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
));
assert(
  new Set(longitudeSteps.map((step) => step.toFixed(3))).size > 2,
  "Sphere layers must not follow one visible spiral",
);
for (const count of [2, 4, 9, 32, 65]) {
  const points = Array.from({ length: count }, (_, index) =>
    generateNodeKeyframes(sphereSettings, index, count)[0]);
  assert(
    points.some((point) => point.y > 0) && points.some((point) => point.y < 0) &&
      points.some((point) => point.z > 0) && points.some((point) => point.z < 0),
    `Sphere must cover both hemispheres with ${count} layers`,
  );
}

const loop = generateNodeKeyframes(settings, 0, 8);
assert(loop.length === 17, "Expected the configured number of keyframes plus the closing key");
assert(Math.abs(loop[0].x - loop.at(-1)!.x) < 1e-6, "Loop X must close");
assert(Math.abs(loop[0].y - loop.at(-1)!.y) < 1e-6, "Loop Y must close");
assert(Math.abs(loop[0].scaleX - loop.at(-1)!.scaleX) < 1e-6, "Loop X scale must close");
assert(Math.abs(loop[0].scaleY - loop.at(-1)!.scaleY) < 1e-6, "Loop Y scale must close");

const renamedGeometry = generateNodeKeyframes({ ...settings, preset: "fan" }, 2, 8);
assert(
  JSON.stringify(renamedGeometry) === JSON.stringify(generateNodeKeyframes(settings, 2, 8)),
  "Preset identity must not affect animation when all settings are identical",
);

const firstSegmentMiddle = (loop[0].time + loop[1].time) / 2;
const sampled = sampleGeneratedKeyframes(
  loop,
  firstSegmentMiddle,
  { type: "easing", duration: 1, ease: [0, 0, 1, 1] },
);
assert(sampled.x !== loop[0].x && sampled.x !== loop[1].x, "Preview sampling must interpolate keys");

const easedSample = sampleGeneratedKeyframes(
  loop,
  firstSegmentMiddle,
  { type: "easing", duration: 1, ease: [0.42, 0, 1, 1] },
);
assert(
  Math.abs(easedSample.x - sampled.x) > 0.01,
  "Preview sampling must apply the selected easing between keyframes",
);

const easedCycle = generateNodeKeyframes({
  ...settings,
  motion: {
    ...settings.motion,
    fullCycle: { type: "easing", duration: 1, ease: [0.4, 0, 0.2, 1] },
  },
}, 0, 8);
assert(
  Math.abs(easedCycle[8].x - loop[8].x) > 1,
  "Full-cycle easing must change the generated path timing",
);

const middleDepth = pointForGeometry(0, settings);
const lateFade = pointForGeometry(0, {
  ...settings,
  appearance: { ...settings.appearance, fadeStart: 50, fadeEnd: 100 },
});
assert(
  Math.abs(lateFade.opacity - settings.appearance.farOpacity) < 1e-6,
  "Fade range must control where opacity starts increasing",
);

const easedFade = pointForGeometry(0, {
  ...settings,
  appearance: {
    ...settings.appearance,
    opacityCurve: "late",
  },
});
assert(
  easedFade.opacity < middleDepth.opacity,
  "Opacity easing must reshape the depth fade",
);

assert(
  depthSplitOpacity({ z: 1, opacity: 0.7 }, "front") === 0.7 &&
    depthSplitOpacity({ z: 1, opacity: 0.7 }, "back") === 0,
  "The front depth layer must only be visible in front",
);
assert(
  depthSplitOpacity({ z: -1, opacity: 0.7 }, "back") === 0.7 &&
    depthSplitOpacity({ z: -1, opacity: 0.7 }, "front") === 0,
  "The back depth layer must only be visible behind",
);

const fitted = fitSettingsToFrame(settings, 320, 240, 280, 200);
assert(
  fitted.geometry.radiusX < settings.geometry.radiusX &&
    fitted.geometry.radiusY < settings.geometry.radiusY,
  "Dynamic scale must fit X/Y movement to the frame",
);
assert(
  fitted.appearance.nearScale < settings.appearance.nearScale,
  "Dynamic scale must shrink oversized layers",
);
const fittedWithDifferentManualRadii = fitSettingsToFrame({
  ...settings,
  geometry: { ...settings.geometry, radiusX: 10, radiusY: 10 },
}, 320, 240, 280, 200);
assert(
  fittedWithDifferentManualRadii.geometry.radiusX === fitted.geometry.radiusX &&
    fittedWithDifferentManualRadii.geometry.radiusY === fitted.geometry.radiusY,
  "Dynamic scale must derive radii from the frame instead of disabled manual controls",
);
const fittedRotatedCircle = fitSettingsToFrame({
  ...settings,
  preset: "circle",
  geometry: { ...settings.geometry, circleRotation: 45 },
}, 320, 240, 80, 80);
const rotatedBoundsX = Math.hypot(
  fittedRotatedCircle.geometry.radiusX / Math.sqrt(2),
  fittedRotatedCircle.geometry.radiusY / Math.sqrt(2),
);
assert(
  rotatedBoundsX <= 55.6 + 1e-6,
  "Dynamic scale must keep a rotated circle inside the selected frame",
);
const manualGeometry = fitSettingsToFrame({
  ...settings,
  geometry: { ...settings.geometry, dynamicScale: false, radiusX: 123, radiusY: 77 },
}, 320, 240, 280, 200);
assert(
  manualGeometry.geometry.radiusX === 123 && manualGeometry.geometry.radiusY === 77,
  "Manual radii must be preserved when Dynamic Scale is disabled",
);

const widePreview = fitPreviewFrame(1600, 900);
assert(
  Math.abs(widePreview.width - 300) < 1e-9 && Math.abs(widePreview.height - 168.75) < 1e-9,
  "Wide previews must preserve frame proportions within the width limit",
);
const tallPreview = fitPreviewFrame(400, 800);
assert(
  Math.abs(tallPreview.width - 110) < 1e-9 && Math.abs(tallPreview.height - 220) < 1e-9,
  "Tall previews must preserve frame proportions within the height limit",
);

for (const preset of presetOptions) {
  const presetSettings = settingsForPreset(preset.value);
  const presetLoop = generateNodeKeyframes(presetSettings, 3, 9);
  assert(
    Math.abs(presetLoop[0].x - presetLoop.at(-1)!.x) < 1e-5 &&
      Math.abs(presetLoop[0].y - presetLoop.at(-1)!.y) < 1e-5,
    `${preset.label} loop must close`,
  );
  const sampledPoints = [];
  for (let step = 0; step < 32; step += 1) {
    const point = pointForGeometry(
      (step / 32) * Math.PI * 2,
      presetSettings,
      3,
      9,
    );
    assert(point.opacity >= 0 && point.opacity <= 1, `${preset.label} opacity is invalid`);
    assert(point.scaleX > 0, `${preset.label} X scale is invalid`);
    assert(point.scaleY > 0, `${preset.label} Y scale is invalid`);
    assert(
      [point.x, point.y, point.z, point.scaleX, point.scaleY, point.opacity, point.rotation].every(Number.isFinite),
      `${preset.label} contains a non-finite animation value`,
    );
    sampledPoints.push(point);
  }
  const xRange = Math.max(...sampledPoints.map((point) => point.x)) - Math.min(...sampledPoints.map((point) => point.x));
  const yRange = Math.max(...sampledPoints.map((point) => point.y)) - Math.min(...sampledPoints.map((point) => point.y));
  assert(xRange > 1 || yRange > 1, `${preset.label} must produce visible movement`);
}

console.log("Orbit engine: all checks passed");
