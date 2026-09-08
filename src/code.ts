/// <reference types="@figma/plugin-typings" />

import {
  depthSplitOpacity,
  fitSettingsToFrame,
  generateNodeKeyframes,
} from "./engine";
import type {
  DialTransition,
  MotionSettings,
  PluginToUiMessage,
  SelectionSummary,
  TargetScope,
  UiToPluginMessage,
} from "./types";

type MotionNode = SceneNode & {
  applyManualKeyframeTrack: (
    field: KeyframeField,
    track: ManualKeyframeTrackInput,
  ) => void;
  removeManualKeyframeTrack: (field: KeyframeField) => void;
  manualKeyframeTracks: ManualKeyframeTracks;
  timelines: ReadonlyArray<Timeline>;
  setTimelineDuration: (id: string, duration: number) => void;
};

const animatedFields: KeyframePropertyFieldName[] = [
  "TRANSLATION_X",
  "TRANSLATION_Y",
  "SCALE_X",
  "SCALE_Y",
  "ROTATION",
  "OPACITY",
];
const orbitMarkerKey = "orbit-motion";
const pluginWidth = 360;
const minPluginHeight = 420;
const maxPluginHeight = 960;

interface OrbitMarker {
  version: number;
  preset: string;
  role?: "front" | "back";
  pairId?: string;
  sourceId?: string;
}

figma.showUI(__html__, {
  width: pluginWidth,
  height: 720,
  themeColors: true,
  title: "Orbit Animator",
});

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function selectionSummary(): SelectionSummary {
  const selection = figma.currentPage.selection;
  const targetPreview = (scope: TargetScope) => {
    const targets = resolveTargets(scope);
    const frameBounds = targets[0]?.getTopLevelFrame()?.absoluteBoundingBox;
    return {
      count: targets.length,
      orbitCount: targets.filter(hasOrbitMotion).length,
      frameWidth: frameBounds?.width ?? 0,
      frameHeight: frameBounds?.height ?? 0,
      items: targets.slice(0, 18).map((node) => {
        const centerOffset = frameCenterOffset(node);
        return {
          width: "width" in node && typeof node.width === "number" ? node.width : 1,
          height: "height" in node && typeof node.height === "number" ? node.height : 1,
          offsetX: -centerOffset.x,
          offsetY: -centerOffset.y,
        };
      }),
    };
  };
  return {
    selected: selection.length,
    names: selection.slice(0, 4).map((node) => node.name),
    types: [...new Set(selection.map((node) => node.type))],
    targets: {
      selection: targetPreview("selection"),
      children: targetPreview("children"),
      deep: targetPreview("deep"),
    },
  };
}

function sendSelection(): void {
  post({ type: "selection", selection: selectionSummary() });
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return "children" in node;
}

function hasSceneChildren(node: BaseNode | null): node is BaseNode & ChildrenMixin {
  return Boolean(node && "children" in node);
}

function readOrbitMarker(node: SceneNode): OrbitMarker | null {
  const value = node.getPluginData(orbitMarkerKey);
  if (!value) return null;
  try {
    return JSON.parse(value) as OrbitMarker;
  } catch {
    return null;
  }
}

function isBackCopy(node: SceneNode): boolean {
  return readOrbitMarker(node)?.role === "back";
}

function isMotionNode(node: SceneNode): node is MotionNode {
  return (
    typeof (node as Partial<MotionNode>).applyManualKeyframeTrack === "function" &&
    typeof (node as Partial<MotionNode>).removeManualKeyframeTrack === "function"
  );
}

function isTimelineOwner(node: SceneNode): boolean {
  return node.type === "FRAME" && node.parent?.type === "PAGE";
}

function collectDescendants(node: SceneNode, deep: boolean): SceneNode[] {
  if (isBackCopy(node)) return [];
  if (!hasChildren(node)) return [node];
  const children = [...node.children];
  if (!deep) return children;

  const result: SceneNode[] = [];
  for (const child of children) {
    if (hasChildren(child) && child.children.length > 0) {
      result.push(...collectDescendants(child, true));
    } else {
      result.push(child);
    }
  }
  return result;
}

function resolveTargets(scope: TargetScope): MotionNode[] {
  const selected = figma.currentPage.selection;
  const expanded: SceneNode[] = [];

  for (const node of selected) {
    if (scope === "deep") {
      expanded.push(...collectDescendants(node, true));
    } else if (scope === "children" || isTimelineOwner(node)) {
      expanded.push(...collectDescendants(node, false));
    } else {
      expanded.push(node);
    }
  }

  const unique = new Map<string, MotionNode>();
  for (const node of expanded) {
    if (isBackCopy(node)) continue;
    if (!isMotionNode(node) || isTimelineOwner(node)) continue;
    if (!node.getTopLevelFrame()) continue;
    unique.set(node.id, node);
  }
  return [...unique.values()];
}

function hasOrbitMotion(node: MotionNode): boolean {
  if (!node.getPluginData(orbitMarkerKey)) return false;
  return animatedFields.some((name) => Boolean(node.manualKeyframeTracks[name]));
}

function easingFromTransition(transition: DialTransition): MotionEasing {
  if (transition?.type === "spring") {
    let bounce = transition.bounce ?? 0.25;
    if (
      typeof transition.mass === "number" &&
      typeof transition.stiffness === "number" &&
      typeof transition.damping === "number"
    ) {
      bounce = figma.motion.physicalSpringToNormalized({
        mass: transition.mass,
        stiffness: transition.stiffness,
        damping: transition.damping,
      });
    }
    return {
      type: "CUSTOM_SPRING",
      easingFunctionSpring: { bounce: Math.min(1, Math.max(0, bounce)) },
    };
  }

  if (Array.isArray(transition?.ease) && transition.ease.length === 4) {
    const [x1, y1, x2, y2] = transition.ease;
    return {
      type: "CUSTOM_CUBIC_BEZIER",
      easingFunctionCubicBezier: { x1, y1, x2, y2 },
    };
  }

  return { type: "EASE_IN_AND_OUT" };
}

function floatTrack(
  baseValue: number,
  frames: ReturnType<typeof generateNodeKeyframes>,
  value: (frame: ReturnType<typeof generateNodeKeyframes>[number]) => number,
  easing: MotionEasing,
): ManualKeyframeTrackInput {
  return {
    baseValue: { type: "FLOAT", value: baseValue },
    keyframes: frames.map((frame, index) => ({
      timelinePosition: frame.time,
      easing: index === frames.length - 1 ? { type: "HOLD" } : easing,
      value: { type: "FLOAT", value: value(frame) },
    })),
  };
}

function frameCenterOffset(node: MotionNode): { x: number; y: number } {
  const nodeBounds = node.absoluteBoundingBox;
  const frameBounds = node.getTopLevelFrame()?.absoluteBoundingBox;
  if (!nodeBounds || !frameBounds) return { x: 0, y: 0 };

  return {
    x: frameBounds.x + frameBounds.width / 2 - (nodeBounds.x + nodeBounds.width / 2),
    y: frameBounds.y + frameBounds.height / 2 - (nodeBounds.y + nodeBounds.height / 2),
  };
}

async function findBackCopies(source: MotionNode): Promise<MotionNode[]> {
  const copies = new Map<string, MotionNode>();
  if (hasSceneChildren(source.parent)) {
    for (const child of source.parent.children) {
      if (!isMotionNode(child)) continue;
      const childMarker = readOrbitMarker(child);
      if (childMarker?.role === "back" && childMarker.sourceId === source.id) {
        copies.set(child.id, child);
      }
    }
  }
  return [...copies.values()];
}

function trySetLocked(node: MotionNode, locked: boolean): boolean {
  try {
    if (node.removed) return false;
    node.locked = locked;
    return true;
  } catch {
    return false;
  }
}

function isLiveNode(node: MotionNode): boolean {
  try {
    return !node.removed;
  } catch {
    return false;
  }
}

function isLockedNode(node: MotionNode): boolean {
  try {
    return !node.removed && node.locked;
  } catch {
    return false;
  }
}

function tryRemoveNode(node: MotionNode): void {
  try {
    if (node.removed) return;
    trySetLocked(node, false);
    node.remove();
  } catch {
    // Figma can invalidate a node reference while an async operation is running.
  }
}

async function ensureBackCopy(
  source: MotionNode,
): Promise<{ node: MotionNode; created: boolean }> {
  const copies = await findBackCopies(source);
  const liveCopies = copies.filter(isLiveNode);
  const preferredPairId = readOrbitMarker(source)?.pairId;
  const existing = liveCopies.find((copy) => copy.id === preferredPairId) ??
    liveCopies.find(isLockedNode) ?? liveCopies[0];
  if (existing && trySetLocked(existing, false)) {
    for (const duplicate of liveCopies) {
      if (duplicate !== existing) tryRemoveNode(duplicate);
    }
    if (hasSceneChildren(source.parent)) source.parent.insertChild(0, existing);
    return { node: existing, created: false };
  }

  const clone = source.clone();
  if (!isMotionNode(clone)) {
    clone.remove();
    throw new Error("This layer cannot be duplicated for depth splitting.");
  }
  clone.name = `${source.name} · Orbit Back`;
  if (hasSceneChildren(source.parent)) source.parent.insertChild(0, clone);
  clone.setPluginData(orbitMarkerKey, JSON.stringify({
    version: 2,
    preset: "",
    role: "back",
    sourceId: source.id,
  } satisfies OrbitMarker));
  return { node: clone, created: true };
}

function applyTracks(
  node: MotionNode,
  frames: ReturnType<typeof generateNodeKeyframes>,
  centerOffset: { x: number; y: number },
  easing: MotionEasing,
  opacity: (frame: ReturnType<typeof generateNodeKeyframes>[number]) => number,
): void {
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "TRANSLATION_X" },
    floatTrack(centerOffset.x, frames, (frame) => centerOffset.x + frame.x, easing),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "TRANSLATION_Y" },
    floatTrack(centerOffset.y, frames, (frame) => centerOffset.y + frame.y, easing),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "SCALE_X" },
    floatTrack(1, frames, (frame) => frame.scaleX, easing),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "SCALE_Y" },
    floatTrack(1, frames, (frame) => frame.scaleY, easing),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "ROTATION" },
    floatTrack(0, frames, (frame) => frame.rotation, easing),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "OPACITY" },
    floatTrack(
      "opacity" in node && typeof node.opacity === "number" ? node.opacity : 1,
      frames,
      opacity,
      easing,
    ),
  );
}

function extendTimelines(
  node: MotionNode,
  duration: number,
  touchedTimelines: Set<string>,
): void {
  for (const timeline of node.timelines) {
    if (touchedTimelines.has(timeline.id)) continue;
    node.setTimelineDuration(timeline.id, Math.max(timeline.duration, duration));
    touchedTimelines.add(timeline.id);
  }
}

async function applyMotion(settings: MotionSettings): Promise<void> {
  const targets = resolveTargets(settings.other.scope);
  if (targets.length === 0) {
    throw new Error(
      "Select layers inside a top-level frame, or select the frame to animate its children.",
    );
  }

  const easing: MotionEasing = easingFromTransition({
    type: "easing",
    duration: 1,
    ease: [0, 0, 1, 1],
  });
  const changed: string[] = [];
  const failures: string[] = [];
  const touchedTimelines = new Set<string>();

  for (let index = 0; index < targets.length; index += 1) {
    const node = targets[index];
    const frameBounds = node.getTopLevelFrame()?.absoluteBoundingBox;
    const nodeWidth = "width" in node && typeof node.width === "number" ? node.width : 1;
    const nodeHeight = "height" in node && typeof node.height === "number" ? node.height : 1;
    const fittedSettings = fitSettingsToFrame(
      settings,
      frameBounds?.width ?? 0,
      frameBounds?.height ?? 0,
      nodeWidth,
      nodeHeight,
    );
    const frames = generateNodeKeyframes(fittedSettings, index, targets.length);
    const centerOffset = settings.other.centerBeforeApply
      ? frameCenterOffset(node)
      : { x: 0, y: 0 };
    let backCopy: MotionNode | null = null;
    let createdBackCopy = false;
    try {
      if (settings.other.depthSplit) {
        const ensured = await ensureBackCopy(node);
        backCopy = ensured.node;
        createdBackCopy = ensured.created;
      } else {
        const staleBackCopies = await findBackCopies(node);
        for (const staleBackCopy of staleBackCopies) tryRemoveNode(staleBackCopy);
      }

      applyTracks(
        node,
        frames,
        centerOffset,
        easing,
        (frame) => settings.other.depthSplit
          ? depthSplitOpacity(frame, "front")
          : frame.opacity,
      );
      extendTimelines(node, settings.motion.duration, touchedTimelines);

      if (backCopy) {
        applyTracks(
          backCopy,
          frames,
          centerOffset,
          easing,
          (frame) => depthSplitOpacity(frame, "back"),
        );
        extendTimelines(backCopy, settings.motion.duration, touchedTimelines);
        backCopy.setPluginData(orbitMarkerKey, JSON.stringify({
          version: 2,
          preset: settings.preset,
          role: "back",
          sourceId: node.id,
        } satisfies OrbitMarker));
        trySetLocked(backCopy, true);
      }

      node.setPluginData(orbitMarkerKey, JSON.stringify({
        version: 2,
        preset: settings.preset,
        role: "front",
        pairId: backCopy?.id,
      } satisfies OrbitMarker));
      changed.push(node.id);
    } catch (error) {
      if (createdBackCopy && backCopy) tryRemoveNode(backCopy);
      else if (backCopy) trySetLocked(backCopy, true);
      failures.push(`${node.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (changed.length === 0) {
    throw new Error(failures[0] ?? "Figma Motion is unavailable for this selection.");
  }

  figma.currentPage.selection = targets;
  figma.viewport.scrollAndZoomIntoView(targets);
  post({
    type: "result",
    kind: "success",
    message: failures.length > 0
      ? `Animated ${changed.length} layers; ${failures.length} could not be changed.`
      : `Animated ${changed.length} layer${changed.length === 1 ? "" : "s"}.`,
  });
  sendSelection();
}

async function clearMotion(scope: TargetScope): Promise<void> {
  const targets = resolveTargets(scope);
  if (targets.length === 0) {
    throw new Error("No animatable layers in the current selection.");
  }

  const orbitTargets = targets.filter((node) => Boolean(node.getPluginData(orbitMarkerKey)));
  if (orbitTargets.length === 0) {
    throw new Error("No Orbit Animator motion in the current selection.");
  }

  let cleared = 0;
  for (const node of orbitTargets) {
    try {
      const backCopies = await findBackCopies(node);
      for (const name of animatedFields) {
        node.removeManualKeyframeTrack({ type: "PROPERTY", name });
      }
      node.setPluginData(orbitMarkerKey, "");
      for (const backCopy of backCopies) tryRemoveNode(backCopy);
      cleared += 1;
    } catch {
      // Some instance descendants are read-only; continue with the rest.
    }
  }
  post({ type: "result", kind: "success", message: `Cleared ${cleared} layer${cleared === 1 ? "" : "s"}.` });
  sendSelection();
}

figma.ui.onmessage = async (message: UiToPluginMessage) => {
  try {
    if (message.type === "apply") await applyMotion(message.settings);
    if (message.type === "clear") await clearMotion(message.scope);
    if (message.type === "refresh-selection") sendSelection();
    if (message.type === "resize") {
      const height = Math.round(
        Math.min(maxPluginHeight, Math.max(minPluginHeight, message.height)),
      );
      figma.ui.resize(pluginWidth, height);
    }
  } catch (error) {
    post({
      type: "result",
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

figma.on("selectionchange", sendSelection);
sendSelection();
