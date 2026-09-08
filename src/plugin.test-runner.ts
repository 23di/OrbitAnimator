// @ts-nocheck
import assert from "node:assert/strict";
import { depthSplitOpacity, generateNodeKeyframes } from "./engine";
import type { MotionSettings } from "./types";

let nextId = 1;
const nodes = new Map<string, any>();
const timeline = { id: "timeline-1", duration: 5 };
let proxyChildReads = false;
const parent = {
  id: "frame-1",
  name: "Orbit Frame",
  type: "FRAME",
  parent: { type: "PAGE" },
  getPluginData: () => "",
  _children: [] as any[],
  get children() {
    return proxyChildReads
      ? this._children.map((child: any) => new Proxy(child, {}))
      : this._children;
  },
  set children(children: any[]) {
    this._children = children;
  },
  insertChild(index: number, node: any) {
    this._children = this._children.filter((child) => child.id !== node.id);
    this._children.splice(index, 0, node);
    node.parent = this;
  },
};
const topFrame = { absoluteBoundingBox: { x: 0, y: 0, width: 720, height: 400 } };

function makeNode(name: string): any {
  const pluginData = new Map<string, string>();
  const node = {
    id: `node-${nextId++}`,
    name,
    type: "RECTANGLE",
    width: 80,
    height: 100,
    opacity: 1,
    absoluteBoundingBox: { x: 320, y: 150, width: 80, height: 100 },
    parent,
    locked: false,
    removed: false,
    timelines: [timeline],
    manualKeyframeTracks: {} as Record<string, unknown>,
    removedTrackNames: [] as string[],
    getTopLevelFrame: () => topFrame,
    getPluginData: (key: string) => pluginData.get(key) ?? "",
    setPluginData: (key: string, value: string) => pluginData.set(key, value),
    applyManualKeyframeTrack(field: { name: string }, track: unknown) {
      this.manualKeyframeTracks[field.name] = track;
    },
    removeManualKeyframeTrack(field: { name: string }) {
      this.removedTrackNames.push(field.name);
      delete this.manualKeyframeTracks[field.name];
    },
    setTimelineDuration(id: string, duration: number) {
      assert.equal(id, timeline.id);
      timeline.duration = duration;
    },
    clone() {
      const clone = makeNode(this.name);
      clone.manualKeyframeTracks = structuredClone(this.manualKeyframeTracks);
      const marker = this.getPluginData("orbit-motion");
      if (marker) clone.setPluginData("orbit-motion", marker);
      return clone;
    },
    remove() {
      this.removed = true;
      parent.children = parent._children.filter((child) => child.id !== this.id);
      nodes.delete(this.id);
    },
  };
  nodes.set(node.id, node);
  return node;
}

const source = makeNode("Card");
parent.children = [source];
let onMessage: ((message: unknown) => Promise<void>) | undefined;
const postedMessages: any[] = [];
globalThis.__html__ = "";
globalThis.figma = {
  showUI() {},
  ui: {
    postMessage(message: unknown) { postedMessages.push(message); },
    resize() {},
    set onmessage(handler) { onMessage = handler; },
    get onmessage() { return onMessage; },
  },
  currentPage: { selection: [source] },
  viewport: { scrollAndZoomIntoView() {} },
  motion: { physicalSpringToNormalized: () => 0.25 },
  getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
  on() {},
};

await import("./code");

const settings: MotionSettings = {
  preset: "orbit-3d-ring",
  motion: {
    duration: 5,
    stagger: 0,
    keyframes: 32,
    direction: "clockwise",
    fullCycle: { type: "easing", duration: 1, ease: [0, 0, 1, 1] },
  },
  geometry: {
    advanced: false,
    shape: "parametric",
    dynamicScale: false,
    customPath: "[[0,0.5],[1,0.5]]",
    radiusX: 260,
    radiusY: 120,
    circleRotation: 0,
    depth: 220,
    tilt: 0,
    turns: 1,
    rotation: 0,
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
    nearScale: 1.2,
    farScale: 0.6,
    farOpacity: 0.25,
    fadeStart: 0,
    fadeEnd: 100,
    opacityCurve: "linear",
    facePath: false,
  },
  other: { centerBeforeApply: true, depthSplit: true, scope: "selection" },
};

function cubic(progress: number, a: number, b: number, c: number, d: number): number {
  const inverse = 1 - progress;
  return inverse ** 3 * a + 3 * inverse ** 2 * progress * b +
    3 * inverse * progress ** 2 * c + progress ** 3 * d;
}

function easingProgress(easing: any, progress: number): number {
  if (easing.type === "HOLD") return 0;
  if (easing.type !== "CUSTOM_CUBIC_BEZIER") return progress;
  const curve = easing.easingFunctionCubicBezier;
  let low = 0;
  let high = 1;
  let parameter = progress;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    parameter = (low + high) / 2;
    if (cubic(parameter, 0, curve.x1, curve.x2, 1) < progress) low = parameter;
    else high = parameter;
  }
  return cubic(parameter, 0, curve.y1, curve.y2, 1);
}

function sampleTrack(track: any, time: number): number {
  const keys = track.keyframes;
  if (time <= keys[0].timelinePosition) return keys[0].value.value;
  const last = keys.at(-1);
  if (time >= last.timelinePosition) return last.value.value;
  let destinationIndex = 1;
  while (destinationIndex < keys.length - 1 && time > keys[destinationIndex].timelinePosition) {
    destinationIndex += 1;
  }
  const from = keys[destinationIndex - 1];
  const to = keys[destinationIndex];
  const local = (time - from.timelinePosition) /
    (to.timelinePosition - from.timelinePosition);
  const progress = easingProgress(to.easing, local);
  return from.value.value + (to.value.value - from.value.value) * progress;
}

function assertSparseTrackAccuracy(activeSettings: MotionSettings): void {
  const frames = generateNodeKeyframes(activeSettings, 0, 1);
  const tracks = source.manualKeyframeTracks;
  for (const frame of frames) {
    assert(Math.abs(sampleTrack(tracks.TRANSLATION_X, frame.time) - frame.x) <= 0.76);
    assert(Math.abs(sampleTrack(tracks.TRANSLATION_Y, frame.time) - frame.y) <= 0.76);
    assert(Math.abs(sampleTrack(tracks.SCALE_X, frame.time) - frame.scaleX) <= 0.0031);
    assert(Math.abs(sampleTrack(tracks.SCALE_Y, frame.time) - frame.scaleY) <= 0.0031);
    assert(Math.abs(sampleTrack(tracks.ROTATION, frame.time) - frame.rotation) <= 0.251);
    const expectedOpacity = activeSettings.other.depthSplit
      ? depthSplitOpacity(frame, "front")
      : frame.opacity;
    assert(Math.abs(sampleTrack(tracks.OPACITY, frame.time) - expectedOpacity) <= 0.0041);
  }
}

assert(onMessage, "Plugin message handler must be registered");
await onMessage({ type: "apply", settings });
assert(
  postedMessages.some((message) => message.type === "result" && message.kind === "success" && message.message === "Animated 1 layer."),
  "Apply must report a successful result",
);
assert.equal(parent.children.length, 2, "Depth Split must create exactly one back copy");
assertSparseTrackAccuracy(settings);
assert(
  Math.max(...Object.values(source.manualKeyframeTracks).map((track: any) => track.keyframes.length)) <= 15,
  "The standard orbit must compress every property from 31 samples to at most 15 keys",
);
const firstBack = parent.children.find((node) => node !== source);
assert(firstBack.locked, "Back copy must be locked after applying tracks");
assert.deepEqual(
  firstBack.removedTrackNames,
  [],
  "The first clean back copy must not run inherited-track cleanup",
);

const currentBack = () => parent.children.find((node) => node !== source);
const assertSynchronizedPair = (back: any) => {
  assert(back, "Depth Split must keep one back copy");
  assert(back.locked, "The current back copy must be locked");
  for (const field of ["TRANSLATION_X", "TRANSLATION_Y", "SCALE_X", "SCALE_Y", "ROTATION"]) {
    assert.deepEqual(
      back.manualKeyframeTracks[field],
      source.manualKeyframeTracks[field],
      `${field} must stay identical on front and back copies`,
    );
  }
};
assertSynchronizedPair(firstBack);

const stalePair = makeNode("Detached stale pair");
stalePair.setPluginData("orbit-motion", JSON.stringify({ role: "back", sourceId: source.id }));
parent.children = parent.children.filter((node) => node !== stalePair);
source.setPluginData("orbit-motion", JSON.stringify({ role: "front", pairId: stalePair.id }));

const staleBack = source.clone();
staleBack.setPluginData("orbit-motion", JSON.stringify({ role: "back", sourceId: source.id }));
parent.insertChild(0, staleBack);
settings.motion.duration = 3;
settings.motion.fullCycle = { type: "easing", duration: 1, ease: [0.42, 0, 1, 1] };
proxyChildReads = true;
await onMessage({ type: "apply", settings });
proxyChildReads = false;
assert.equal(parent.children.length, 2, "Refresh must remove stale duplicate back copies");
const refreshedBack = currentBack();
assertSparseTrackAccuracy(settings);
assert.equal(refreshedBack.id, firstBack.id, "Refresh must preserve the existing back-copy id");
assert.deepEqual(
  new Set(refreshedBack.removedTrackNames),
  new Set(["TRANSLATION_X", "TRANSLATION_Y", "SCALE_X", "SCALE_Y", "ROTATION", "OPACITY"]),
  "Refresh must remove every inherited front track before writing back tracks",
);
assert(!firstBack.removed, "Refresh must keep the existing paired back copy");
assert(staleBack.removed, "Refresh must remove stale unpaired back copies");
assertSynchronizedPair(refreshedBack);
assert.equal(timeline.duration, 3, "Refresh must shorten the Motion timeline to the new duration");
assert.equal(
  source.manualKeyframeTracks.TRANSLATION_X.keyframes.at(-1).timelinePosition,
  3,
  "Refreshed source tracks must end at the new duration",
);
assert.equal(
  refreshedBack.manualKeyframeTracks.TRANSLATION_X.keyframes.at(-1).timelinePosition,
  3,
  "Refreshed back-copy tracks must end at the new duration",
);
for (const node of [source, refreshedBack]) {
  const keyframes = node.manualKeyframeTracks.TRANSLATION_X.keyframes;
  assert.equal(
    keyframes[0].easing.type,
    "HOLD",
    "Only the first key may use HOLD because it has no incoming segment",
  );
  assert.notEqual(
    keyframes.at(-1).easing.type,
    "HOLD",
    "The closing key must interpolate the final leg instead of jumping at loop end",
  );
  const easing = keyframes[1].easing;
  assert(
    easing.type === "CUSTOM_CUBIC_BEZIER" || easing.type === "LINEAR",
    "Sparse tracks must use supported interpolation",
  );
  assert(
    keyframes.length < settings.motion.keyframes + 1,
    "Sparse motion must use fewer keys than the generated source samples",
  );
}

const timingCases = [
  { duration: 0.4, ease: [0, 0, 1, 1], radiusX: 80, radiusY: 40, rotation: -135, tilt: -60 },
  { duration: 3, ease: [0.42, 0, 1, 1], radiusX: 260, radiusY: 120, rotation: 0, tilt: 0 },
  { duration: 5, ease: [0, 0, 0.58, 1], radiusX: 600, radiusY: 300, rotation: 75, tilt: 45 },
  { duration: 12, ease: [0.42, 0, 0.58, 1], radiusX: 1200, radiusY: 800, rotation: 180, tilt: 90 },
] as const;
let previousBack = refreshedBack;
for (const timing of timingCases) {
  settings.motion.duration = timing.duration;
  settings.motion.fullCycle = { type: "easing", duration: 1, ease: [...timing.ease] };
  settings.geometry.radiusX = timing.radiusX;
  settings.geometry.radiusY = timing.radiusY;
  settings.geometry.circleRotation = timing.rotation;
  settings.geometry.tilt = timing.tilt;
  await onMessage({ type: "apply", settings });
  assert.equal(timeline.duration, timing.duration, "Every supported duration must update the timeline");
  assert.equal(parent.children.length, 2, "Every refresh must leave exactly one back copy");
  const back = currentBack();
  assert.equal(back.id, previousBack.id, "Every refresh must preserve the paired back-copy id");
  assert(!previousBack.removed, "Refresh must not remove the paired back copy");
  assertSynchronizedPair(back);
  previousBack = back;
  for (const node of [source, back]) {
    const track = node.manualKeyframeTracks.TRANSLATION_X;
    assert.equal(
      track.keyframes.at(-1).timelinePosition,
      timing.duration,
      "Front and back tracks must end at every selected duration",
    );
    assert(
      track.keyframes.length < settings.motion.keyframes + 1,
      "Every built-in timing must retain sparse front and back tracks",
    );
  }
}

settings.other.depthSplit = false;
await onMessage({ type: "apply", settings });
assert.equal(parent.children.length, 1, "Disabling Depth Split must remove every back copy");
assert(previousBack.removed, "Disabling Depth Split must remove the current back copy");
assert(
  source.manualKeyframeTracks.OPACITY.keyframes.some((keyframe: any) => keyframe.value.value > 0),
  "The source must retain its normal opacity animation without Depth Split",
);

settings.other.depthSplit = true;
await onMessage({ type: "apply", settings });
assert.equal(parent.children.length, 2, "Re-enabling Depth Split must create exactly one fresh back copy");
const reenabledBack = currentBack();
assertSynchronizedPair(reenabledBack);
assert.equal(
  new Set(reenabledBack.removedTrackNames).size,
  6,
  "A recreated back copy must clear all inherited front tracks",
);

await onMessage({ type: "clear", scope: "selection" });
assert.equal(parent.children.length, 1, "Clear must remove every linked back copy");
assert.equal(Object.keys(source.manualKeyframeTracks).length, 0, "Clear must remove source motion tracks");
assert(
  postedMessages.some((message) => message.type === "result" && message.kind === "success" && message.message === "Cleared 1 layer."),
  "Clear must report a successful result",
);

await onMessage({ type: "clear", scope: "selection" });
assert(
  postedMessages.some((message) => message.type === "result" && message.kind === "error" && message.message === "No Orbit Animator motion in the current selection."),
  "Clearing an unchanged selection must report an error",
);

globalThis.figma.currentPage.selection = [parent];
settings.other.scope = "children";
await onMessage({ type: "apply", settings });
assert.deepEqual(
  globalThis.figma.currentPage.selection,
  [parent],
  "Applying to a top-level frame must preserve the user's frame selection",
);
assert.equal(parent.children.length, 2, "Frame Apply must create one back copy");
const frameApplyBack = currentBack();
await onMessage({ type: "apply", settings });
assert.deepEqual(
  globalThis.figma.currentPage.selection,
  [parent],
  "Refreshing must continue targeting the selected frame",
);
assert.equal(parent.children.length, 2, "Frame Refresh must not create extra copies");
assert.equal(currentBack().id, frameApplyBack.id, "Frame Refresh must preserve its paired copy");
await onMessage({ type: "clear", scope: "children" });
assert.equal(parent.children.length, 1, "Frame Clear must remove the paired copy");

globalThis.figma.currentPage.selection = [];
await onMessage({ type: "apply", settings });
assert(
  postedMessages.some((message) => message.type === "result" && message.kind === "error" && message.message.startsWith("Select layers inside")),
  "Applying with no selection must report an actionable error",
);

console.log("Orbit plugin doubling: all checks passed");
