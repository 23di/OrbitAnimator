/// <reference types="@figma/plugin-typings" />

import {
  depthSplitOpacity,
  fitSettingsToFrame,
  generateNodeKeyframes,
} from "./engine";
import type {
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

const linearEasing: MotionEasing = { type: "LINEAR" };
const holdEasing: MotionEasing = { type: "HOLD" };

function cubicValue(progress: number, a: number, b: number, c: number, d: number): number {
  const inverse = 1 - progress;
  return inverse ** 3 * a +
    3 * inverse ** 2 * progress * b +
    3 * inverse * progress ** 2 * c +
    progress ** 3 * d;
}

/**
 * Fits the generated samples with piecewise cubic Hermite segments. Figma's
 * easing lives on the destination keyframe, so each returned key carries the
 * curve for the segment that leads into it. Using 1/3 and 2/3 for the easing's
 * X handles makes its parameter exactly linear in timeline time; the Y handles
 * can then encode the sampled property's curve directly.
 */
function sparseFloatTrack(
  baseValue: number,
  frames: ReturnType<typeof generateNodeKeyframes>,
  value: (frame: ReturnType<typeof generateNodeKeyframes>[number]) => number,
  tolerance: number,
): ManualKeyframeTrackInput {
  const values = frames.map(value);
  const selected = new Map<number, MotionEasing>();
  selected.set(0, holdEasing);

  const fit = (start: number, end: number): void => {
    if (end <= start) return;
    if (end - start === 1) {
      selected.set(end, linearEasing);
      return;
    }

    const startTime = frames[start].time;
    const endTime = frames[end].time;
    const duration = endTime - startTime;
    const delta = values[end] - values[start];
    let split = start + 1;
    let maximumError = -1;

    if (duration > Number.EPSILON && Math.abs(delta) > Number.EPSILON) {
      const startStep = frames[start + 1].time - startTime;
      const endStep = endTime - frames[end - 1].time;
      const startSlope = startStep > Number.EPSILON
        ? (values[start + 1] - values[start]) / startStep
        : 0;
      const endSlope = endStep > Number.EPSILON
        ? (values[end] - values[end - 1]) / endStep
        : 0;
      const y1 = startSlope * duration / (3 * delta);
      const y2 = 1 - endSlope * duration / (3 * delta);
      const candidates: Array<[number, number]> = [[y1, y2]];

      // A least-squares candidate handles globally eased or spring-warped
      // cycles with fewer segments than endpoint slopes alone.
      let a11 = 0;
      let a12 = 0;
      let a22 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let index = start + 1; index < end; index += 1) {
        const progress = (frames[index].time - startTime) / duration;
        const inverse = 1 - progress;
        const basis1 = 3 * inverse ** 2 * progress;
        const basis2 = 3 * inverse * progress ** 2;
        const target = (values[index] - values[start]) / delta - progress ** 3;
        a11 += basis1 ** 2;
        a12 += basis1 * basis2;
        a22 += basis2 ** 2;
        b1 += basis1 * target;
        b2 += basis2 * target;
      }
      const determinant = a11 * a22 - a12 ** 2;
      if (Math.abs(determinant) > 1e-9) {
        candidates.push([
          (b1 * a22 - b2 * a12) / determinant,
          (a11 * b2 - a12 * b1) / determinant,
        ]);
      }

      let best: { y1: number; y2: number; error: number; split: number } | null = null;
      for (const [candidateY1, candidateY2] of candidates) {
        if (
          !Number.isFinite(candidateY1) || !Number.isFinite(candidateY2) ||
          Math.abs(candidateY1) > 6 || Math.abs(candidateY2) > 6
        ) continue;
        let candidateError = -1;
        let candidateSplit = start + 1;
        for (let index = start + 1; index < end; index += 1) {
          const progress = (frames[index].time - startTime) / duration;
          const predicted = values[start] +
            delta * cubicValue(progress, 0, candidateY1, candidateY2, 1);
          const error = Math.abs(predicted - values[index]);
          if (error > candidateError) {
            candidateError = error;
            candidateSplit = index;
          }
        }
        if (!best || candidateError < best.error) {
          best = { y1: candidateY1, y2: candidateY2, error: candidateError, split: candidateSplit };
        }
      }
      if (best) {
        maximumError = best.error;
        split = best.split;
        if (best.error <= tolerance) {
          selected.set(end, {
            type: "CUSTOM_CUBIC_BEZIER",
            easingFunctionCubicBezier: {
              x1: 1 / 3,
              y1: best.y1,
              x2: 2 / 3,
              y2: best.y2,
            },
          });
          return;
        }
      }
    } else {
      for (let index = start + 1; index < end; index += 1) {
        const error = Math.abs(values[index] - values[start]);
        if (error > maximumError) {
          maximumError = error;
          split = index;
        }
      }
      if (maximumError <= tolerance) {
        selected.set(end, linearEasing);
        return;
      }
    }

    fit(start, split);
    fit(split, end);
  };

  fit(0, frames.length - 1);
  return {
    baseValue: { type: "FLOAT", value: baseValue },
    keyframes: [...selected.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, easing]) => ({
        timelinePosition: frames[index].time,
        easing,
        value: { type: "FLOAT", value: values[index] },
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

function clearAnimatedTracks(node: MotionNode): void {
  for (const name of animatedFields) {
    if (node.manualKeyframeTracks[name]) {
      node.removeManualKeyframeTrack({ type: "PROPERTY", name });
    }
  }
}

async function ensureBackCopy(
  source: MotionNode,
): Promise<{ node: MotionNode; created: boolean }> {
  const copies = (await findBackCopies(source)).filter(isLiveNode);
  const preferredPairId = readOrbitMarker(source)?.pairId;
  const existing = copies.find((copy) => copy.id === preferredPairId) ??
    copies.find(isLockedNode) ?? copies[0];

  if (existing && trySetLocked(existing, false)) {
    for (const duplicate of copies) {
      if (duplicate.id !== existing.id) tryRemoveNode(duplicate);
    }
    if (hasSceneChildren(source.parent)) source.parent.insertChild(0, existing);
    clearAnimatedTracks(existing);
    return { node: existing, created: false };
  }

  const clone = source.clone();
  if (!isMotionNode(clone)) {
    clone.remove();
    throw new Error("This layer cannot be duplicated for depth splitting.");
  }
  clone.name = `${source.name} · Orbit Back`;
  if (hasSceneChildren(source.parent)) source.parent.insertChild(0, clone);
  // The first Apply clones a clean source and needs no cleanup. If a back copy
  // has to be recreated later, the source already owns front-split tracks;
  // remove those inherited tracks before writing the new back set.
  if (readOrbitMarker(source)) clearAnimatedTracks(clone);
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
  opacity: (frame: ReturnType<typeof generateNodeKeyframes>[number]) => number,
): void {
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "TRANSLATION_X" },
    sparseFloatTrack(centerOffset.x, frames, (frame) => centerOffset.x + frame.x, 0.75),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "TRANSLATION_Y" },
    sparseFloatTrack(centerOffset.y, frames, (frame) => centerOffset.y + frame.y, 0.75),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "SCALE_X" },
    sparseFloatTrack(1, frames, (frame) => frame.scaleX, 0.003),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "SCALE_Y" },
    sparseFloatTrack(1, frames, (frame) => frame.scaleY, 0.003),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "ROTATION" },
    sparseFloatTrack(0, frames, (frame) => frame.rotation, 0.25),
  );
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "OPACITY" },
    sparseFloatTrack(
      "opacity" in node && typeof node.opacity === "number" ? node.opacity : 1,
      frames,
      opacity,
      0.004,
    ),
  );
}

function setTimelineDurations(
  node: MotionNode,
  duration: number,
  touchedTimelines: Set<string>,
): void {
  for (const timeline of node.timelines) {
    if (touchedTimelines.has(timeline.id)) continue;
    node.setTimelineDuration(timeline.id, duration);
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
        applyTracks(
          backCopy,
          frames,
          centerOffset,
          (frame) => depthSplitOpacity(frame, "back"),
        );
      } else {
        const staleBackCopies = await findBackCopies(node);
        for (const staleBackCopy of staleBackCopies) tryRemoveNode(staleBackCopy);
      }

      applyTracks(
        node,
        frames,
        centerOffset,
        (frame) => settings.other.depthSplit
          ? depthSplitOpacity(frame, "front")
          : frame.opacity,
      );
      setTimelineDurations(node, settings.motion.duration, touchedTimelines);

      if (backCopy) {
        setTimelineDurations(backCopy, settings.motion.duration, touchedTimelines);
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
  let failures = 0;
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
      failures += 1;
    }
  }
  if (cleared === 0) {
    throw new Error("Orbit Animator could not clear motion from the selected layers.");
  }
  post({
    type: "result",
    kind: "success",
    message: failures > 0
      ? `Cleared ${cleared} layer${cleared === 1 ? "" : "s"}; ${failures} could not be changed.`
      : `Cleared ${cleared} layer${cleared === 1 ? "" : "s"}.`,
  });
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
