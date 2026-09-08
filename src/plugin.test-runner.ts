// @ts-nocheck
import assert from "node:assert/strict";
import type { MotionSettings } from "./types";

let nextId = 1;
const nodes = new Map<string, any>();
const timeline = { id: "timeline-1", duration: 5 };
let proxyChildReads = false;
const parent = {
  type: "FRAME",
  parent: { type: "PAGE" },
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
    keyframes: 8,
    direction: "clockwise",
    fullCycle: { type: "easing", duration: 1, ease: [0, 0, 1, 1] },
  },
  geometry: {
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

assert(onMessage, "Plugin message handler must be registered");
await onMessage({ type: "apply", settings });
assert(
  postedMessages.some((message) => message.type === "result" && message.kind === "success" && message.message === "Animated 1 layer."),
  "Apply must report a successful result",
);
assert.equal(parent.children.length, 2, "Depth Split must create exactly one back copy");
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
  const easing = node.manualKeyframeTracks.TRANSLATION_X.keyframes[0].easing;
  assert.equal(easing.type, "CUSTOM_CUBIC_BEZIER", "Selected easing must be written to every track");
  assert.deepEqual(
    easing.easingFunctionCubicBezier,
    { x1: 0.42, y1: 0, x2: 1, y2: 1 },
    "Front and back tracks must use the selected easing curve",
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
    assert.deepEqual(
      track.keyframes[0].easing.easingFunctionCubicBezier,
      { x1: timing.ease[0], y1: timing.ease[1], x2: timing.ease[2], y2: timing.ease[3] },
      "Every built-in easing must be written to front and back tracks",
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

globalThis.figma.currentPage.selection = [];
await onMessage({ type: "apply", settings });
assert(
  postedMessages.some((message) => message.type === "result" && message.kind === "error" && message.message.startsWith("Select layers inside")),
  "Applying with no selection must report an actionable error",
);

console.log("Orbit plugin doubling: all checks passed");
