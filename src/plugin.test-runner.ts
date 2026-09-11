// @ts-nocheck
import assert from "node:assert/strict";
import { depthSplitOpacity, generateNodeKeyframes } from "./engine";
import { builtInPresetTunings } from "./presets";
import { presetOptions, type MotionSettings } from "./types";

let nextId = 1;
const nodes = new Map<string, any>();
const timeline = { id: "timeline-1", duration: 5 };
let proxyChildReads = false;
let findAllCalls = 0;
let failTrackWrite: { nodeId: string; field: string; remaining?: number } | null = null;
let failTrackRemoval: { nodeId: string; field: string } | null = null;
let parentRelaunchData: Record<string, string> = {};
let insertChildCalls = 0;
let failInsertChildRemaining = 0;
let viewportNavigationCalls = 0;
const parent = {
  id: "frame-1",
  name: "Orbit Frame",
  type: "FRAME",
  parent: { type: "PAGE" },
  getPluginData: () => "",
  setRelaunchData(data: Record<string, string>) { parentRelaunchData = { ...data }; },
  getRelaunchData() { return { ...parentRelaunchData }; },
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
    insertChildCalls += 1;
    if (failInsertChildRemaining > 0) {
      failInsertChildRemaining -= 1;
      throw new Error("Simulated stale insertChild proxy");
    }
    this._children = this._children.filter((child) => child.id !== node.id);
    this._children.splice(index, 0, node);
    node.parent = this;
  },
};
nodes.set(parent.id, parent);
const topFrame = { absoluteBoundingBox: { x: 0, y: 0, width: 720, height: 400 } };

function makeNode(name: string): any {
  const pluginData = new Map<string, string>();
  let relaunchData: Record<string, string> = {};
  const node = {
    id: `node-${nextId++}`,
    name,
    type: "RECTANGLE",
    width: 80,
    height: 100,
    opacity: 1,
    effects: [] as any[],
    absoluteBoundingBox: { x: 320, y: 150, width: 80, height: 100 },
    _parent: parent,
    get parent() {
      if (this.removed) throw new Error(`in get_parent: The node with id "${this.id}" does not exist`);
      return this._parent;
    },
    set parent(value: any) { this._parent = value; },
    locked: false,
    removed: false,
    timelines: [timeline],
    manualKeyframeTracks: {} as Record<string, unknown>,
    removedTrackNames: [] as string[],
    getTopLevelFrame: () => topFrame,
    getPluginData: (key: string) => pluginData.get(key) ?? "",
    setPluginData: (key: string, value: string) => pluginData.set(key, value),
    setRelaunchData: (data: Record<string, string>) => { relaunchData = { ...data }; },
    getRelaunchData: () => ({ ...relaunchData }),
    applyManualKeyframeTrack(field: { name: string }, track: unknown) {
      if (failTrackWrite?.nodeId === this.id && failTrackWrite.field === field.name) {
        if ((failTrackWrite.remaining ?? 1) > 1) failTrackWrite.remaining = (failTrackWrite.remaining ?? 1) - 1;
        else failTrackWrite = null;
        throw new Error("Simulated stale Figma node");
      }
      this.manualKeyframeTracks[field.name] = track;
    },
    removeManualKeyframeTrack(field: { name: string }) {
      if (failTrackRemoval?.nodeId === this.id && failTrackRemoval.field === field.name) {
        failTrackRemoval = null;
        throw new Error("Simulated track removal failure");
      }
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
      clone.effects = structuredClone(this.effects);
      const marker = this.getPluginData("orbit-motion");
      if (marker) clone.setPluginData("orbit-motion", marker);
      parent.insertChild(parent.children.indexOf(this) + 1, clone);
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
const userBlur = { type: "LAYER_BLUR", blurType: "NORMAL", radius: 7, visible: true };
source.effects = [userBlur];
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
  currentPage: {
    selection: [source],
    findAll(predicate: (node: any) => boolean) {
      findAllCalls += 1;
      return [...nodes.values()].filter((node) => !node.removed && predicate(node));
    },
  },
  viewport: { scrollAndZoomIntoView() { viewportNavigationCalls += 1; } },
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
    farBlur: 0,
    frontShadow: 0,
    facePath: false,
  },
  other: { centerBeforeApply: true, serviceLayers: "2", depthSplit: true, scope: "selection" },
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
    const opacityError = Math.abs(sampleTrack(tracks.OPACITY, frame.time) - expectedOpacity);
    const intentionalHandoff = tracks.OPACITY.keyframes.some((keyframe: any) =>
      keyframe.timelinePosition === frame.time && keyframe.easing.type === "HOLD"
    );
    assert(opacityError <= 0.0041 || intentionalHandoff);
  }
}

assert(onMessage, "Plugin message handler must be registered");
const findAllCallsBeforeApply = findAllCalls;
const firstApply = onMessage({ type: "apply", settings });
const duplicateApply = onMessage({ type: "apply", settings });
await Promise.all([firstApply, duplicateApply]);
assert.equal(
  findAllCalls - findAllCallsBeforeApply,
  2,
  "Apply must scan the page once for inventory and once for postcondition verification",
);
assert.equal(parent.children.length, 2, "Concurrent Apply messages must collapse into one operation");
assert.equal(viewportNavigationCalls, 0, "Apply must preserve the user's canvas zoom and position");
assert(
  postedMessages.some((message) => message.type === "result" && message.kind === "success" && message.message === "Animated 1 layer."),
  "Apply must report a successful result",
);
assert.equal(parent.children.length, 2, "Depth Split must create exactly one back copy");
assert.deepEqual(
  source.getRelaunchData(),
  { "edit-orbit": "Edit 3D · Turntable animation in Orbit Animator" },
  "Animated sources must expose the native Orbit relaunch action",
);
assert.deepEqual(
  parent.getRelaunchData(),
  { "edit-orbit": "Edit 3D · Turntable animation in Orbit Animator" },
  "The animated source's parent must expose the same Orbit relaunch action",
);
assertSparseTrackAccuracy(settings);
assert(
  Math.max(...Object.values(source.manualKeyframeTracks).map((track: any) => track.keyframes.length)) <= 15,
  "The standard orbit must compress every property from 31 samples to at most 15 keys",
);
const firstBack = parent.children.find((node) => node !== source);
assert(firstBack.locked, "Back copy must be locked after applying tracks");
assert.deepEqual(firstBack.getRelaunchData(), {}, "Service copies must not expose a relaunch action");
assert.deepEqual(
  firstBack.effects,
  [userBlur],
  "A fresh service copy must preserve the source layer's own blur effect",
);
assert.equal(firstBack.name, "Card · Orbit Depth 1 (service)", "Back copy must be visibly marked as service-owned");
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
for (const node of [source, firstBack]) {
  const opacityKeys = node.manualKeyframeTracks.OPACITY.keyframes;
  assert(
    opacityKeys.slice(1).some((keyframe: any) => keyframe.easing.type === "HOLD"),
    "Depth handoffs must switch copies with HOLD instead of crossfading overlapping layers",
  );
}

settings.appearance.farBlur = 12;
// Figma can expose the playhead's animated opacity here. Refresh must retain
// the original base captured by the first Orbit Apply instead of persisting 0.
source.opacity = 0;
const insertCallsBeforeStableRefresh = insertChildCalls;
await onMessage({ type: "apply", settings });
assert.equal(
  insertChildCalls,
  insertCallsBeforeStableRefresh,
  "A stable Refresh must not perform redundant layer reordering",
);
assert.deepEqual(
  firstBack.effects.map((effect: any) => effect.radius),
  [7, 12],
  "Orbit blur must be added without replacing the source blur",
);
assert.equal(JSON.parse(source.getPluginData("orbit-motion")).baseOpacity, 1);
assert.equal((source.manualKeyframeTracks.OPACITY as any).baseValue.value, 1);
assert(
  generateNodeKeyframes(settings, 0, 1).some((frame) => (
    sampleTrack(source.manualKeyframeTracks.OPACITY, frame.time) > 0 &&
    sampleTrack(firstBack.manualKeyframeTracks.OPACITY, frame.time) > 0
  )),
  "Blur handoff must reveal the sharper layer before switching off the farther layer",
);
settings.appearance.farBlur = 4;
await onMessage({ type: "apply", settings });
assert.deepEqual(
  firstBack.effects.map((effect: any) => effect.radius),
  [7, 4],
  "Refreshing Orbit blur must replace only the previously managed effect",
);
settings.appearance.farBlur = 0;
await onMessage({ type: "apply", settings });
assert.deepEqual(firstBack.effects, [userBlur], "Disabling Orbit blur must preserve the source blur");

const foreignBack = makeNode("Foreign service copy");
foreignBack.setPluginData("orbit-motion", JSON.stringify({
  role: "back",
  sourceId: "another-source",
  service: true,
}));
parent.insertChild(0, foreignBack);
const sourceMarkerWithForeignId = JSON.parse(source.getPluginData("orbit-motion"));
source.setPluginData("orbit-motion", JSON.stringify({
  ...sourceMarkerWithForeignId,
  pairId: foreignBack.id,
  serviceIds: [foreignBack.id],
}));
await onMessage({ type: "apply", settings });
assert(!foreignBack.removed, "A stale service id must never steal a copy owned by another source");
assert(!firstBack.removed, "Refresh must retain the service copy with the matching source id");
assert.deepEqual(
  JSON.parse(source.getPluginData("orbit-motion")).serviceIds,
  [firstBack.id],
  "Refresh must repair stale service ids with the correctly owned copy",
);
foreignBack.remove();

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
  refreshedBack.removedTrackNames,
  [],
  "Refresh must replace service tracks directly without redundant removals",
);
assert(!firstBack.removed, "Refresh must keep the existing paired back copy");
assert(staleBack.removed, "Refresh must remove stale unpaired back copies");
assert(stalePair.removed, "Refresh must remove moved stale service copies across the page");
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
settings.other.serviceLayers = "0";
await onMessage({ type: "apply", settings });
assert.equal(parent.children.length, 1, "Disabling Depth Split must remove every back copy");
assert(previousBack.removed, "Disabling Depth Split must remove the current back copy");
assert(
  source.manualKeyframeTracks.OPACITY.keyframes.some((keyframe: any) => keyframe.value.value > 0),
  "The source must retain its normal opacity animation without Depth Split",
);

settings.other.depthSplit = true;
settings.other.serviceLayers = "2";
await onMessage({ type: "apply", settings });
assert.equal(parent.children.length, 2, "Re-enabling Depth Split must create exactly one fresh back copy");
const reenabledBack = currentBack();
assertSynchronizedPair(reenabledBack);
assert.equal(
  new Set(reenabledBack.removedTrackNames).size,
  0,
  "A recreated back copy must replace inherited tracks without removing them first",
);

settings.other.serviceLayers = "4";
failTrackWrite = { nodeId: source.id, field: "TRANSLATION_X" };
await onMessage({ type: "apply", settings });
assert.equal(
  parent.children.length,
  4,
  "A multi-copy refresh must recover from a transient source write failure without duplicate services",
);
assert.deepEqual(
  parent.children
    .filter((node) => node !== source)
    .map((node) => JSON.parse(node.getPluginData("orbit-motion")).depthLayer)
    .sort(),
  [0, 1, 2],
  "Every service copy must own one distinct depth band",
);

const fourLayerServices = parent.children.filter((node) => node !== source);
parent.children = [source, ...fourLayerServices.reverse()];
failInsertChildRemaining = 1;
await onMessage({ type: "apply", settings });
assert.deepEqual(
  parent.children.slice(0, 3).map((node) => JSON.parse(node.getPluginData("orbit-motion")).depthLayer),
  [0, 1, 2],
  "Refresh must retry stale insertChild proxies and verify the final service order",
);

settings.other.serviceLayers = "2";
await onMessage({ type: "apply", settings });
assert.equal(parent.children.length, 2, "Reducing depth layers must remove surplus service copies on refresh");

const protectedBack = currentBack();
const relaunchBeforeFailedRefresh = source.getRelaunchData();
settings.other.serviceLayers = "0";
const messagesBeforeFailedUpdate = postedMessages.length;
failTrackWrite = { nodeId: source.id, field: "TRANSLATION_X", remaining: 2 };
await onMessage({ type: "apply", settings });
assert.equal(
  parent.children.length,
  2,
  "A failed two-attempt update must preserve old service layers",
);
assert(!protectedBack.removed, "A failed update must not delete the existing service copy");
assert.deepEqual(
  source.getRelaunchData(),
  relaunchBeforeFailedRefresh,
  "A failed update must retain the source relaunch action",
);
assert(
  postedMessages.slice(messagesBeforeFailedUpdate).some((message) =>
    message.type === "result" && message.kind === "error" &&
    message.message.startsWith("Update stopped; no old service layers were removed.")
  ),
  "A failed update must report an error instead of partial success",
);
await onMessage({ type: "apply", settings });
assert.equal(parent.children.length, 1, "A clean retry must finish the pending service removal");
settings.other.serviceLayers = "2";
await onMessage({ type: "apply", settings });
assert.equal(parent.children.length, 2, "The service pair must be recreated before Clear testing");

const markerBeforeFailedClear = source.getPluginData("orbit-motion");
failTrackRemoval = { nodeId: source.id, field: "ROTATION" };
await onMessage({ type: "clear", scope: "selection" });
assert.equal(parent.children.length, 2, "A partial Clear must retain the linked service copy");
assert.equal(
  source.getPluginData("orbit-motion"),
  markerBeforeFailedClear,
  "A partial Clear must retain its Orbit marker so the operation can be retried",
);
assert.deepEqual(
  parent.getRelaunchData(),
  relaunchBeforeFailedRefresh,
  "A partial Clear must retain the parent's Orbit relaunch action",
);
source.setPluginData("orbit-motion", "");

await onMessage({ type: "clear", scope: "selection" });
assert.equal(parent.children.length, 1, "Clear must remove every linked back copy");
assert.equal(Object.keys(source.manualKeyframeTracks).length, 0, "Clear must remove source motion tracks");
assert.equal(source.opacity, 1, "Clear must restore the original opacity after playhead-state refreshes");
assert.deepEqual(source.getRelaunchData(), {}, "Clear must remove the Orbit relaunch action");
assert.deepEqual(parent.getRelaunchData(), {}, "Clear must remove an empty parent's Orbit relaunch action");
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
source.absoluteBoundingBox = { x: 100, y: 40, width: 80, height: 100 };
await onMessage({ type: "apply", settings });
assert.deepEqual(
  globalThis.figma.currentPage.selection,
  [parent],
  "Applying to a top-level frame must preserve the user's frame selection",
);
assert.equal(parent.children.length, 2, "Frame Apply must create one back copy");
const frameApplyBack = currentBack();
const persistedCenter = JSON.parse(source.getPluginData("orbit-motion")).centerOffset;
assert.deepEqual(persistedCenter, { x: 220, y: 110 }, "Apply must persist the source's unanimated center offset");
source.absoluteBoundingBox = { x: -900, y: 740, width: 80, height: 100 };
await onMessage({ type: "apply", settings });
assert.deepEqual(
  globalThis.figma.currentPage.selection,
  [parent],
  "Refreshing must continue targeting the selected frame",
);
assert.equal(parent.children.length, 2, "Frame Refresh must not create extra copies");
assert.equal(currentBack().id, frameApplyBack.id, "Frame Refresh must preserve its paired copy");
assert.deepEqual(
  JSON.parse(source.getPluginData("orbit-motion")).centerOffset,
  persistedCenter,
  "Refresh must ignore the playhead-transformed absoluteBoundingBox and reuse the original center",
);
assert.equal(
  source.manualKeyframeTracks.TRANSLATION_X.baseValue.value,
  220,
  "Preset updates must not accumulate horizontal translation drift",
);
assert.equal(
  source.manualKeyframeTracks.TRANSLATION_Y.baseValue.value,
  110,
  "Preset updates must not accumulate vertical translation drift",
);

const interruptedClone = source.clone();
interruptedClone.name = "Card · Orbit Depth 99 (service)";
interruptedClone.setPluginData("orbit-motion", JSON.stringify({ role: "front", preset: settings.preset }));
interruptedClone.locked = true;
await onMessage({ type: "apply", settings });
assert.equal(
  parent.children.length,
  2,
  "Frame Refresh must adopt and remove an interrupted service clone instead of duplicating it",
);
assert(interruptedClone.removed, "Refresh must remove a service-named clone with an inherited front marker");

await onMessage({ type: "clear", scope: "selection" });
assert.equal(parent.children.length, 1, "Frame Clear must ignore scope and remove the paired copy");
assert.equal(Object.keys(source.manualKeyframeTracks).length, 0, "Frame Clear must remove descendant source tracks");
source.absoluteBoundingBox = { x: 320, y: 150, width: 80, height: 100 };

const orphanService = makeNode("Missing source · Orbit Depth 1 (service)");
orphanService.locked = true;
parent.insertChild(0, orphanService);
await onMessage({ type: "clear", scope: "selection" });
assert(orphanService.removed, "Frame Clear must remove an orphaned service layer without a source marker");

globalThis.figma.currentPage.selection = [source];
settings.other.scope = "selection";
await onMessage({ type: "apply", settings });
assert.equal(parent.children.length, 2, "Unlocked source must have a service copy before lock cleanup");
source.locked = true;
const messageCountBeforeLockedApply = postedMessages.length;
await onMessage({ type: "apply", settings });
assert.equal(
  Object.keys(source.manualKeyframeTracks).length,
  0,
  "Apply must ignore a user-locked source layer",
);
assert.equal(parent.children.length, 1, "Refreshing a locked Orbit source must remove its service copies");
assert.equal(source.getPluginData("orbit-motion"), "", "Refreshing a locked Orbit source must clear its marker");
assert(
  postedMessages.slice(messageCountBeforeLockedApply).some((message) =>
    message.type === "result" && message.kind === "error" && message.message === "Locked layers are ignored. Unlock a layer to animate it."
  ),
  "Ignoring a locked-only selection must return the normal no-target message",
);
source.locked = false;

const secondSource = makeNode("Second Card");
parent.insertChild(parent.children.length, secondSource);
source.setPluginData("orbit-motion", JSON.stringify({
  role: "back",
  sourceId: "stale-source-id",
  preset: settings.preset,
}));
globalThis.figma.currentPage.selection = [parent];
settings.other.scope = "selection";
settings.preset = "orbit-3d-vertical";
await onMessage({ type: "apply", settings });
assert.equal(
  parent.children.filter((node) => / \u00b7 Orbit Depth \d+ \(service\)$/.test(node.name)).length,
  2,
  "Parent Apply must create exactly one service layer for every source",
);
assert.equal(
  JSON.parse(source.getPluginData("orbit-motion")).role,
  "front",
  "Apply must recover an unlocked original carrying a stale back-role marker",
);
settings.preset = "orbit-3d-ring";
await onMessage({ type: "apply", settings });
assert.equal(
  parent.children.filter((node) => / \u00b7 Orbit Depth \d+ \(service\)$/.test(node.name)).length,
  2,
  "Changing a preset on a parent must reconcile existing services without duplicates",
);

// Reproduce a real document upgraded from an interrupted version: generated
// names still identify the sibling services, but their stored source ids are stale.
const servicesBeforeCatalogWalk = parent.children.filter((node) =>
  / \u00b7 Orbit Depth \d+ \(service\)$/.test(node.name)
);
for (const service of servicesBeforeCatalogWalk) {
  const marker = JSON.parse(service.getPluginData("orbit-motion"));
  service.setPluginData("orbit-motion", JSON.stringify({ ...marker, sourceId: "missing-old-source" }));
}
for (const preset of presetOptions) {
  const tuning = builtInPresetTunings[preset.value];
  settings.preset = preset.value;
  Object.assign(settings.geometry, tuning.geometry);
  Object.assign(settings.appearance, tuning.appearance);
  Object.assign(settings.other, tuning.other);
  await onMessage({ type: "apply", settings });
  const services = parent.children.filter((node) =>
    / \u00b7 Orbit Depth \d+ \(service\)$/.test(node.name)
  );
  assert.equal(
    services.length,
    2,
    `${preset.label}: walking the entire preset catalog must keep exactly one service per source`,
  );
  assert.equal(new Set(services.map((node) => node.id)).size, 2, `${preset.label}: service ids must stay unique`);
}
await onMessage({ type: "clear", scope: "selection" });
assert.equal(parent.children.length, 2, "Parent Clear must leave only the two original sources");
assert.equal(Object.keys(source.manualKeyframeTracks).length, 0);
assert.equal(Object.keys(secondSource.manualKeyframeTracks).length, 0);

globalThis.figma.currentPage.selection = [];
await onMessage({ type: "apply", settings });
assert(
  postedMessages.some((message) => message.type === "result" && message.kind === "error" && message.message.startsWith("Select layers inside")),
  "Applying with no selection must report an actionable error",
);

console.log("Orbit plugin doubling: all checks passed");
