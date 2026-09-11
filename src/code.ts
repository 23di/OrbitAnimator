/// <reference types="@figma/plugin-typings" />

import {
  fitSettingsToFrame,
  generateNodeKeyframes,
} from "./engine";
import { presetOptions } from "./types";
import type {
  MotionSettings,
  PresetId,
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
const editOrbitCommand = "edit-orbit";
const pluginWidth = 360;
const minPluginHeight = 420;
const maxPluginHeight = 960;
const internalKeyframeSamples = 32;

interface OrbitMarker {
  version: number;
  preset: string;
  role?: "front" | "back";
  service?: true;
  depthLayer?: number;
  pairId?: string;
  serviceIds?: string[];
  sourceId?: string;
  shadowEffect?: DropShadowEffect;
  blurEffect?: BlurEffect;
  effectsVersion?: number;
  baseOpacity?: number;
  centerOffset?: { x: number; y: number };
  settings?: MotionSettings;
}

figma.showUI(__html__, {
  width: pluginWidth,
  height: 580,
  themeColors: true,
  title: "Orbit Animator",
});

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function selectionSummary(): SelectionSummary {
  const selection = figma.currentPage.selection;
  const animatedTarget = ([
    ...resolveTargets("selection"),
    ...resolveTargets("children"),
    ...resolveTargets("deep"),
  ]).find((node) => readOrbitMarker(node)?.role === "front");
  const animatedMarker = animatedTarget ? readOrbitMarker(animatedTarget) : null;
  const preset = animatedMarker?.preset;
  const appliedPreset = preset && presetOptions.some((option) => option.value === preset)
    ? preset as PresetId
    : null;
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
    appliedSettings: animatedMarker?.settings ?? null,
    appliedPreset,
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

function tryGetParent(node: BaseNode): BaseNode | null {
  try {
    if ("removed" in node && node.removed) return null;
    return node.parent;
  } catch {
    return null;
  }
}

function readOrbitMarker(node: SceneNode): OrbitMarker | null {
  try {
    if (node.removed) return null;
    const value = node.getPluginData(orbitMarkerKey);
    if (!value) return null;
    return JSON.parse(value) as OrbitMarker;
  } catch {
    return null;
  }
}

function setOrbitRelaunch(node: BaseNode, marker?: OrbitMarker): void {
  if (!marker) {
    node.setRelaunchData({});
    return;
  }
  const presetLabel = presetOptions.find((option) => option.value === marker.preset)?.label;
  node.setRelaunchData({
    [editOrbitCommand]: presetLabel
      ? `Edit ${presetLabel} animation in Orbit Animator`
      : "Edit this animation in Orbit Animator",
  });
}

function isSceneContainer(node: BaseNode | null): node is SceneNode & ChildrenMixin {
  return Boolean(
    node && node.type !== "DOCUMENT" && node.type !== "PAGE" && "children" in node,
  );
}

function findOrbitDescendantMarker(container: SceneNode & ChildrenMixin): OrbitMarker | null {
  for (const child of container.children) {
    const marker = readOrbitMarker(child);
    if (marker?.role === "front") return marker;
    if (isSceneContainer(child)) {
      const nested = findOrbitDescendantMarker(child);
      if (nested) return nested;
    }
  }
  return null;
}

function syncContainerRelaunch(container: SceneNode & ChildrenMixin): void {
  const marker = findOrbitDescendantMarker(container);
  setOrbitRelaunch(container, marker ?? undefined);
}

function collectRelaunchContainers(targets: ReadonlyArray<MotionNode>): Set<SceneNode & ChildrenMixin> {
  const containers = new Set<SceneNode & ChildrenMixin>();
  for (const target of targets) {
    const parent = tryGetParent(target);
    if (isSceneContainer(parent)) containers.add(parent);
  }
  for (const selected of figma.currentPage.selection) {
    if (!isSceneContainer(selected)) continue;
    const containsTarget = targets.some((target) => {
      let ancestor: BaseNode | null = tryGetParent(target);
      while (ancestor) {
        if (ancestor.id === selected.id) return true;
        ancestor = tryGetParent(ancestor);
      }
      return false;
    });
    if (containsTarget) containers.add(selected);
  }
  return containers;
}

function isServiceNamed(node: SceneNode): boolean {
  return / · Orbit Depth \d+ \(service\)$/.test(node.name) ||
    / · Orbit Back$/.test(node.name);
}

function isBackCopy(node: SceneNode): boolean {
  const marker = readOrbitMarker(node);
  if (marker?.role !== "back") return false;
  // Old interrupted versions could leave role=back on the original. A real
  // completed service is either visibly named as one or locked by Orbit.
  return isServiceNamed(node) || ("locked" in node && node.locked);
}

function isOrbitService(node: SceneNode): boolean {
  return isBackCopy(node) || isServiceNamed(node);
}

function isMotionNode(node: SceneNode): node is MotionNode {
  return (
    typeof (node as Partial<MotionNode>).applyManualKeyframeTrack === "function" &&
    typeof (node as Partial<MotionNode>).removeManualKeyframeTrack === "function"
  );
}

function isTimelineOwner(node: SceneNode): boolean {
  return node.type === "FRAME" && tryGetParent(node)?.type === "PAGE";
}

function collectDescendants(node: SceneNode, deep: boolean, includeLocked: boolean): SceneNode[] {
  if (isOrbitService(node)) return [];
  if (!includeLocked && "locked" in node && node.locked) return [];
  if (!hasChildren(node)) return [node];
  const children = [...node.children];
  if (!deep) return children;

  const result: SceneNode[] = [];
  for (const child of children) {
    if (hasChildren(child) && child.children.length > 0) {
      result.push(...collectDescendants(child, true, includeLocked));
    } else {
      result.push(child);
    }
  }
  return result;
}

function resolveTargets(scope: TargetScope, includeLocked = false): MotionNode[] {
  const selected = figma.currentPage.selection;
  const expanded: SceneNode[] = [];

  for (const node of selected) {
    // Refresh an already animated source directly. Expanding it again in
    // Children/Deep mode would move the target one level farther down after
    // the previous Apply selected or left an animated container active.
    if (readOrbitMarker(node)?.role === "front") {
      expanded.push(node);
    } else if (scope === "deep") {
      expanded.push(...collectDescendants(node, true, includeLocked));
    } else if (scope === "children" || isTimelineOwner(node)) {
      expanded.push(...collectDescendants(node, false, includeLocked));
    } else {
      expanded.push(node);
    }
  }

  const unique = new Map<string, MotionNode>();
  for (const node of expanded) {
    if (isOrbitService(node)) continue;
    if (!includeLocked && "locked" in node && node.locked) continue;
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
  steppedState?: (frame: ReturnType<typeof generateNodeKeyframes>[number]) => boolean,
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

  if (steppedState) {
    let segmentStart = 0;
    for (let index = 1; index < frames.length; index += 1) {
      if (steppedState(frames[index]) === steppedState(frames[index - 1])) continue;

      // Front/back copies occupy the same pixels at a depth handoff. A regular
      // crossfade briefly composites two translucent copies and looks darker.
      // HOLD keeps exactly one copy visible, then switches it on this keyframe.
      fit(segmentStart, index - 1);
      selected.set(index, holdEasing);
      segmentStart = index;
    }
    fit(segmentStart, frames.length - 1);
  } else {
    fit(0, frames.length - 1);
  }
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

function sourceCenterOffset(node: MotionNode): { x: number; y: number } {
  const marker = readOrbitMarker(node);
  if (
    marker?.centerOffset && Number.isFinite(marker.centerOffset.x) &&
    Number.isFinite(marker.centerOffset.y)
  ) {
    return marker.centerOffset;
  }

  // Before centerOffset was persisted, centered Orbit tracks already stored
  // the original offset as their base value. Recover it from the tracks rather
  // than absoluteBoundingBox, which Figma evaluates at the current playhead.
  if (marker?.settings?.other.centerBeforeApply) {
    const x = node.manualKeyframeTracks.TRANSLATION_X?.baseValue;
    const y = node.manualKeyframeTracks.TRANSLATION_Y?.baseValue;
    if (
      x?.type === "FLOAT" && y?.type === "FLOAT" &&
      Number.isFinite(x.value) && Number.isFinite(y.value)
    ) {
      return { x: x.value, y: y.value };
    }
  }
  return frameCenterOffset(node);
}

function findMarkedPageNodes(): SceneNode[] {
  return figma.currentPage.findAll((node) => node.getPluginData(orbitMarkerKey) !== "");
}

async function findBackCopies(
  source: MotionNode,
  resolveMovedPair = false,
  markedPageNodes?: ReadonlyArray<SceneNode>,
  claimedServiceIds?: ReadonlySet<string>,
): Promise<MotionNode[]> {
  const copies = new Map<string, MotionNode>();
  const preferredPairId = readOrbitMarker(source)?.pairId;
  const preferredIds = new Set(readOrbitMarker(source)?.serviceIds ?? []);
  const collect = (candidate: SceneNode, allowNameRecovery: boolean): void => {
    try {
      if (
        candidate.removed || candidate.id === source.id || !isMotionNode(candidate) ||
        claimedServiceIds?.has(candidate.id)
      ) return;
      const marker = readOrbitMarker(candidate);
      const sameNamedService = candidate.name.startsWith(`${source.name} · Orbit Depth `) &&
        isServiceNamed(candidate);
      if (
        (marker?.role === "back" || sameNamedService) &&
        (
          marker?.sourceId === source.id ||
          (!marker?.sourceId && (
            candidate.id === preferredPairId || preferredIds.has(candidate.id)
          )) ||
          (allowNameRecovery && sameNamedService)
        )
      ) {
        copies.set(candidate.id, candidate);
      }
    } catch {
      // A removed service can remain in an operation snapshot.
    }
  };
  const sourceParent = tryGetParent(source);
  if (hasSceneChildren(sourceParent)) {
    for (const child of sourceParent.children) {
      // Generated names are a recovery key for old/interrupted versions whose
      // sourceId became stale. Only trust that fallback beside the source.
      collect(child, true);
    }
  }
  // Service copies can be dragged into another frame or survive an interrupted
  // refresh. Scan their lightweight plugin markers so Apply can collapse every
  // copy belonging to this source back to exactly one.
  if (resolveMovedPair) {
    for (const candidate of markedPageNodes ?? findMarkedPageNodes()) {
      collect(candidate, false);
    }
  }
  if (resolveMovedPair && preferredPairId && !copies.has(preferredPairId)) {
    const paired = await figma.getNodeByIdAsync(preferredPairId);
    if (paired && paired.type !== "DOCUMENT" && paired.type !== "PAGE") collect(paired, false);
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

function clearAnimatedTracksSafely(node: MotionNode): boolean {
  let cleared = true;
  for (const name of animatedFields) {
    try {
      if (node.manualKeyframeTracks[name]) {
        node.removeManualKeyframeTrack({ type: "PROPERTY", name });
      }
    } catch {
      cleared = false;
    }
  }
  return cleared;
}

async function removeNodeSafely(node: MotionNode): Promise<boolean> {
  let id: string | null = null;
  try {
    id = node.id;
    if (!node.removed) {
      trySetLocked(node, false);
      node.remove();
      return true;
    }
  } catch {
    // Resolve the id again below; Figma may have invalidated this proxy.
  }

  if (!id) return false;
  const resolved = await figma.getNodeByIdAsync(id);
  if (!resolved) return true;
  if (resolved.type === "DOCUMENT" || resolved.type === "PAGE" || !isMotionNode(resolved)) {
    return false;
  }
  try {
    trySetLocked(resolved, false);
    resolved.remove();
    return true;
  } catch {
    return false;
  }
}

async function ensureBackCopies(
  source: MotionNode,
  count: number,
  markedPageNodes: ReadonlyArray<SceneNode>,
  claimedServiceIds: Set<string>,
): Promise<{ nodeIds: string[]; createdIds: string[]; surplusIds: string[] }> {
  const sourceId = source.id;
  const sourceName = source.name;
  const sourceMarker = readOrbitMarker(source);
  const discovered = (await findBackCopies(
    source,
    true,
    markedPageNodes,
    claimedServiceIds,
  )).filter(isLiveNode);
  const sourceParent = tryGetParent(source);
  const sourceParentId = hasSceneChildren(sourceParent) ? sourceParent.id : null;
  // Page scans can retain stale proxy objects after an interrupted refresh.
  // Resolve candidates again before touching their effects or animation tracks.
  const resolvedCopies = await Promise.all(
    discovered.map((candidate) => figma.getNodeByIdAsync(candidate.id)),
  );
  const copies = resolvedCopies.filter((resolved): resolved is MotionNode => (
    Boolean(
      resolved && resolved.type !== "DOCUMENT" && resolved.type !== "PAGE" &&
      isMotionNode(resolved) && isLiveNode(resolved),
    )
  ));
  const reusable = copies.sort((left, right) =>
    Number(readOrbitMarker(left)?.sourceId !== sourceId) -
      Number(readOrbitMarker(right)?.sourceId !== sourceId) ||
    Number(tryGetParent(left)?.id !== sourceParentId) -
      Number(tryGetParent(right)?.id !== sourceParentId) ||
    (readOrbitMarker(left)?.depthLayer ?? 99) - (readOrbitMarker(right)?.depthLayer ?? 99)
  );
  const reusableIds = reusable.map((copy) => copy.id);
  const nodeIds: string[] = [];
  const createdIds: string[] = [];
  for (let layer = 0; layer < count; layer += 1) {
    const reusableId = reusableIds[layer];
    const reusableNode = reusableId ? await figma.getNodeByIdAsync(reusableId) : null;
    let copy = reusableNode && reusableNode.type !== "DOCUMENT" && reusableNode.type !== "PAGE" &&
      isMotionNode(reusableNode)
      ? reusableNode
      : undefined;
    if (!copy || !trySetLocked(copy, false)) {
      const freshSource = await figma.getNodeByIdAsync(sourceId);
      if (
        !freshSource || freshSource.type === "DOCUMENT" || freshSource.type === "PAGE" ||
        !isMotionNode(freshSource)
      ) {
        throw new Error("The source layer became unavailable while duplicating services.");
      }
      const clone = freshSource.clone();
      if (!isMotionNode(clone)) {
        clone.remove();
        throw new Error("This layer cannot be duplicated for depth sorting.");
      }
      copy = clone;
      copy.name = `${sourceName} · Orbit Depth ${layer + 1} (service)`;
      // clone() inherits the source marker. Mark it as service-owned before
      // any other mutation so an interrupted Apply can never turn the clone
      // into another source during the next refresh.
      removeManagedFrontShadow(copy);
      copy.setPluginData(orbitMarkerKey, JSON.stringify({
        version: 2,
        preset: sourceMarker?.preset ?? "",
        role: "back",
        service: true,
        depthLayer: layer,
        sourceId,
      } satisfies OrbitMarker));
      setOrbitRelaunch(copy);
      createdIds.push(copy.id);
    }
    const copyId = copy.id;
    if (sourceParentId && tryGetParent(copy)?.id !== sourceParentId) {
      const freshParent = await figma.getNodeByIdAsync(sourceParentId);
      if (!hasSceneChildren(freshParent)) {
        throw new Error("The source parent became unavailable while ordering services.");
      }
      freshParent.insertChild(0, copy);
    }
    const finalizedCopy = await figma.getNodeByIdAsync(copyId);
    if (
      !finalizedCopy || finalizedCopy.type === "DOCUMENT" || finalizedCopy.type === "PAGE" ||
      !isMotionNode(finalizedCopy)
    ) {
      throw new Error(`Service layer ${layer + 1} became unavailable after insertion.`);
    }
    finalizedCopy.name = `${sourceName} · Orbit Depth ${layer + 1} (service)`;
    setOrbitRelaunch(finalizedCopy);
    nodeIds.push(copyId);
    claimedServiceIds.add(copyId);
  }
  // Surplus removal is deliberately deferred until every replacement track
  // has been written successfully. Otherwise one failing setter leaves holes.
  return { nodeIds, createdIds, surplusIds: reusableIds.slice(count) };
}

function depthBand(frame: ReturnType<typeof generateNodeKeyframes>[number], depth: number, count: number): number {
  if (count <= 1) return 0;
  const normalized = depth > 0 ? Math.max(0, Math.min(0.999999, (frame.z / depth + 1) / 2)) : 0.5;
  return Math.floor(normalized * count);
}

function depthLayerWeight(
  frame: ReturnType<typeof generateNodeKeyframes>[number],
  depth: number,
  count: number,
  layer: number,
  smoothHandoff: boolean,
): number {
  const band = depthBand(frame, depth, count);
  if (!smoothHandoff || layer === 0 || band !== layer - 1 || depth <= 0) {
    return band === layer ? 1 : 0;
  }

  // The nearer (sharper) copy fades in on top of the fully opaque farther
  // copy, then the farther copy switches off. This softens the blur handoff
  // without the transparency dip caused by a conventional crossfade.
  const normalized = Math.max(0, Math.min(0.999999, (frame.z / depth + 1) / 2));
  const progress = normalized * count - band;
  const transition = 0.3;
  if (progress <= 1 - transition) return 0;
  const t = (progress - (1 - transition)) / transition;
  return t * t * (3 - 2 * t);
}

function blurRadiusForLayer(layer: number, layerCount: number, farBlur: number): number {
  if (farBlur <= 0 || layerCount <= 1) return 0;
  return farBlur * (layerCount - 1 - layer) / (layerCount - 1);
}

type PreparedPropertyTrack = {
  name: KeyframePropertyFieldName;
  track: ManualKeyframeTrackInput;
};

function prepareTransformTracks(
  frames: ReturnType<typeof generateNodeKeyframes>,
  centerOffset: { x: number; y: number },
): PreparedPropertyTrack[] {
  return [
    { name: "TRANSLATION_X", track: sparseFloatTrack(centerOffset.x, frames, (frame) => centerOffset.x + frame.x, 0.75) },
    { name: "TRANSLATION_Y", track: sparseFloatTrack(centerOffset.y, frames, (frame) => centerOffset.y + frame.y, 0.75) },
    { name: "SCALE_X", track: sparseFloatTrack(1, frames, (frame) => frame.scaleX, 0.003) },
    { name: "SCALE_Y", track: sparseFloatTrack(1, frames, (frame) => frame.scaleY, 0.003) },
    { name: "ROTATION", track: sparseFloatTrack(0, frames, (frame) => frame.rotation, 0.25) },
  ];
}

function applyTracks(
  node: MotionNode,
  frames: ReturnType<typeof generateNodeKeyframes>,
  transformTracks: ReadonlyArray<PreparedPropertyTrack>,
  baseOpacity: number,
  opacity: (frame: ReturnType<typeof generateNodeKeyframes>[number]) => number,
  opacityState?: (frame: ReturnType<typeof generateNodeKeyframes>[number]) => boolean,
): void {
  for (const prepared of transformTracks) {
    node.applyManualKeyframeTrack(
      { type: "PROPERTY", name: prepared.name },
      prepared.track,
    );
  }
  node.applyManualKeyframeTrack(
    { type: "PROPERTY", name: "OPACITY" },
    sparseFloatTrack(
      baseOpacity,
      frames,
      opacity,
      0.004,
      opacityState,
    ),
  );
}

function sourceBaseOpacity(node: MotionNode): number {
  const marker = readOrbitMarker(node);
  if (typeof marker?.baseOpacity === "number") return marker.baseOpacity;
  // v2 markers predate base-opacity persistence and may already contain the
  // playhead's transient opacity as their track base. The old implementation
  // generated absolute 0..1 opacity, so 1 is the only safe migration value.
  if (marker) return 1;
  return "opacity" in node && typeof node.opacity === "number" ? node.opacity : 1;
}

function restoreSourceOpacity(node: MotionNode, marker: OrbitMarker | null): void {
  if (!("opacity" in node)) return;
  node.opacity = typeof marker?.baseOpacity === "number" ? marker.baseOpacity : 1;
}

function applyManagedBackBlur(
  node: MotionNode,
  radius: number,
  freshCopy: boolean,
): BlurEffect | undefined {
  if (!("effects" in node)) return undefined;
  const previous = JSON.stringify(node.effects);
  const marker = readOrbitMarker(node);
  const managed = marker?.blurEffect;
  const serialized = managed ? JSON.stringify(managed) : null;
  const effects = freshCopy
    ? [...node.effects]
    : marker?.effectsVersion === 1
    ? node.effects.filter((effect) => !serialized || JSON.stringify(effect) !== serialized)
    // Older Orbit versions did not record which blur they owned. Their service
    // copies can be migrated safely because the previous implementation always
    // replaced every layer blur on those generated nodes.
    : node.effects.filter((effect) => effect.type !== "LAYER_BLUR");
  const blur: BlurEffect | undefined = radius > 0
    ? { type: "LAYER_BLUR", blurType: "NORMAL", radius, visible: true }
    : undefined;
  if (blur) effects.push(blur);
  if (JSON.stringify(effects) !== previous) node.effects = effects;
  return blur;
}

function removeManagedFrontShadow(node: MotionNode): void {
  if (!("effects" in node)) return;
  const managed = readOrbitMarker(node)?.shadowEffect;
  if (!managed) return;
  const serialized = JSON.stringify(managed);
  const effects = node.effects.filter((effect) => JSON.stringify(effect) !== serialized);
  if (effects.length !== node.effects.length) node.effects = effects;
}

function applyManagedFrontShadow(node: MotionNode, radius: number): DropShadowEffect | undefined {
  if (!("effects" in node)) return undefined;
  const previous = JSON.stringify(node.effects);
  const managed = readOrbitMarker(node)?.shadowEffect;
  const serialized = managed ? JSON.stringify(managed) : null;
  const effects = node.effects.filter((effect) => !serialized || JSON.stringify(effect) !== serialized);
  const shadow: DropShadowEffect | undefined = radius > 0 ? {
    type: "DROP_SHADOW",
    color: { r: 0, g: 0, b: 0, a: 0.3 },
    offset: { x: 0, y: Math.max(2, radius * 0.5) },
    radius,
    spread: 0,
    visible: true,
    blendMode: "NORMAL",
    showShadowBehindNode: false,
  } : undefined;
  if (shadow) effects.push(shadow);
  if (JSON.stringify(effects) !== previous) node.effects = effects;
  return shadow;
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
  // Locking a layer is also a way to opt it out on refresh. If it was animated
  // earlier, remove only Orbit-owned tracks/copies instead of leaving stale
  // motion running while the layer is skipped.
  const candidates = resolveTargets(settings.other.scope, true);
  const markedPageNodes = findMarkedPageNodes();
  const lockedOrbitTargets = candidates.filter((node) => (
    "locked" in node && node.locked && readOrbitMarker(node)?.role === "front"
  ));
  const lockedContainers = collectRelaunchContainers(lockedOrbitTargets);
  for (const node of lockedOrbitTargets) {
    const copies = await findBackCopies(node, true, markedPageNodes);
    const copyIds = copies.map((copy) => copy.id);
    const marker = readOrbitMarker(node);
    if (!clearAnimatedTracksSafely(node)) continue;
    restoreSourceOpacity(node, marker);
    removeManagedFrontShadow(node);
    node.setPluginData(orbitMarkerKey, "");
    setOrbitRelaunch(node);
    for (const copyId of copyIds) {
      const copy = await figma.getNodeByIdAsync(copyId);
      if (copy && copy.type !== "DOCUMENT" && copy.type !== "PAGE" && isMotionNode(copy)) {
        await removeNodeSafely(copy);
      }
    }
  }
  for (const container of lockedContainers) syncContainerRelaunch(container);

  const targets = resolveTargets(settings.other.scope);
  if (targets.length === 0) {
    if (figma.currentPage.selection.some((node) => "locked" in node && node.locked)) {
      throw new Error("Locked layers are ignored. Unlock a layer to animate it.");
    }
    throw new Error(
      "Select layers inside a top-level frame, or select the frame to animate its children.",
    );
  }

  const changed: string[] = [];
  const failures: string[] = [];
  const touchedTimelines = new Set<string>();
  const serviceOrder: Array<{
    nodeId: string;
    parentId: string;
    layer: number;
    target: number;
  }> = [];
  const targetIds = targets.map((target) => target.id);
  const pendingRemovalIds = new Set<string>();
  const claimedServiceIds = new Set<string>();
  const configuredLayers = Number(
    settings.other.serviceLayers ?? (settings.other.depthSplit === false ? "0" : "2"),
  );
  const layerCount = Math.max(
    configuredLayers,
    settings.appearance.farBlur > 0 || settings.appearance.frontShadow > 0 ? 2 : 0,
  );
  const useDepthLayers = layerCount > 1;

  for (let index = 0; index < targetIds.length; index += 1) {
    const targetId = targetIds[index];
    const targetName = targets[index].name;
    const resolvedTarget = await figma.getNodeByIdAsync(targetId);
    if (
      !resolvedTarget || resolvedTarget.type === "DOCUMENT" || resolvedTarget.type === "PAGE" ||
      !isMotionNode(resolvedTarget)
    ) {
      failures.push(`${targetName}: the layer became unavailable.`);
      continue;
    }
    const node = resolvedTarget;
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
    const frames = generateNodeKeyframes({
      ...fittedSettings,
      motion: { ...fittedSettings.motion, keyframes: internalKeyframeSamples },
    }, index, targets.length);
    const originalCenterOffset = sourceCenterOffset(node);
    const centerOffset = settings.other.centerBeforeApply
      ? originalCenterOffset
      : { x: 0, y: 0 };
    const transformTracks = prepareTransformTracks(frames, centerOffset);
    const baseOpacity = sourceBaseOpacity(node);
    const targetParent = tryGetParent(node);
    const targetParentId = hasSceneChildren(targetParent) ? targetParent.id : null;
    let completed = false;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2 && !completed; attempt += 1) {
      let createdIds: string[] = [];
      let claimedAttemptIds: string[] = [];
      try {
        const freshSource = await figma.getNodeByIdAsync(targetId);
        if (
          !freshSource || freshSource.type === "DOCUMENT" || freshSource.type === "PAGE" ||
          !isMotionNode(freshSource)
        ) {
          throw new Error("The source layer became unavailable.");
        }

        let backCopyIds: string[] = [];
        let surplusIds: string[] = [];
        if (useDepthLayers) {
          const ensured = await ensureBackCopies(
            freshSource,
            layerCount - 1,
            markedPageNodes,
            claimedServiceIds,
          );
          backCopyIds = ensured.nodeIds;
          claimedAttemptIds = [...backCopyIds];
          createdIds = ensured.createdIds;
          surplusIds = ensured.surplusIds;

          for (let layer = 0; layer < backCopyIds.length; layer += 1) {
            const copyId = backCopyIds[layer];
            const resolvedCopy = await figma.getNodeByIdAsync(copyId);
            if (
              !resolvedCopy || resolvedCopy.type === "DOCUMENT" || resolvedCopy.type === "PAGE" ||
              !isMotionNode(resolvedCopy)
            ) {
              throw new Error(`Service layer ${layer + 1} became unavailable.`);
            }
            const blurEffect = applyManagedBackBlur(
              resolvedCopy,
              blurRadiusForLayer(layer, layerCount, settings.appearance.farBlur),
              createdIds.includes(copyId),
            );
            applyTracks(
              resolvedCopy,
              frames,
              transformTracks,
              0,
              (frame) => frame.opacity * depthLayerWeight(
                frame,
                fittedSettings.geometry.depth,
                layerCount,
                layer,
                settings.appearance.farBlur > 0,
              ),
              settings.appearance.farBlur > 0
                ? undefined
                : (frame) => depthBand(frame, fittedSettings.geometry.depth, layerCount) === layer,
            );
            resolvedCopy.setPluginData(orbitMarkerKey, JSON.stringify({
              version: 2,
              preset: settings.preset,
              role: "back",
              service: true,
              depthLayer: layer,
              sourceId: targetId,
              blurEffect,
              effectsVersion: 1,
            } satisfies OrbitMarker));
            trySetLocked(resolvedCopy, true);
          }
        } else {
          surplusIds = (await findBackCopies(freshSource, true, markedPageNodes))
            .map((copy) => copy.id);
        }

        // Structural clone/insert operations invalidate real Figma proxies.
        const sourceForTracks = await figma.getNodeByIdAsync(targetId);
        if (
          !sourceForTracks || sourceForTracks.type === "DOCUMENT" || sourceForTracks.type === "PAGE" ||
          !isMotionNode(sourceForTracks)
        ) {
          throw new Error("The source layer became unavailable after duplicating services.");
        }
        const shadowEffect = applyManagedFrontShadow(
          sourceForTracks,
          settings.appearance.frontShadow,
        );
        applyTracks(
          sourceForTracks,
          frames,
          transformTracks,
          baseOpacity,
          (frame) => useDepthLayers
            ? frame.opacity * depthLayerWeight(
              frame,
              fittedSettings.geometry.depth,
              layerCount,
              layerCount - 1,
              settings.appearance.farBlur > 0,
            )
            : frame.opacity,
          useDepthLayers
            ? settings.appearance.farBlur > 0
              ? undefined
              : (frame) => depthBand(frame, fittedSettings.geometry.depth, layerCount) === layerCount - 1
            : undefined,
        );
        setTimelineDurations(sourceForTracks, settings.motion.duration, touchedTimelines);

        const sourceMarker = {
          version: 2,
          preset: settings.preset,
          role: "front",
          pairId: backCopyIds[0],
          serviceIds: backCopyIds,
          shadowEffect,
          baseOpacity,
          centerOffset: originalCenterOffset,
          settings,
        } satisfies OrbitMarker;
        sourceForTracks.setPluginData(orbitMarkerKey, JSON.stringify(sourceMarker));
        setOrbitRelaunch(sourceForTracks, sourceMarker);

        for (const id of surplusIds) pendingRemovalIds.add(id);
        if (targetParentId) {
          for (let layer = 0; layer < backCopyIds.length; layer += 1) {
            serviceOrder.push({
              nodeId: backCopyIds[layer],
              parentId: targetParentId,
              layer,
              target: index,
            });
          }
        }
        changed.push(targetId);
        completed = true;
      } catch (error) {
        lastError = error;
        for (const id of claimedAttemptIds) claimedServiceIds.delete(id);
        for (const id of createdIds) {
          const created = await figma.getNodeByIdAsync(id);
          if (created && created.type !== "DOCUMENT" && created.type !== "PAGE" && isMotionNode(created)) {
            await removeNodeSafely(created);
          }
        }
      }
    }
    if (!completed) {
      failures.push(`${targetName}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Update stopped; no old service layers were removed. ${failures.join(" ")}`);
  }

  for (const id of pendingRemovalIds) {
    const surplus = await figma.getNodeByIdAsync(id);
    if (!surplus) continue;
    if (surplus.type === "DOCUMENT" || surplus.type === "PAGE" || !isMotionNode(surplus)) {
      throw new Error("Update stopped while removing an obsolete service layer.");
    }
    if (!await removeNodeSafely(surplus)) {
      throw new Error("Update stopped while removing an obsolete service layer.");
    }
  }

  const parentIds = new Set(serviceOrder.map(({ parentId }) => parentId));
  for (const parentId of parentIds) {
    const ordered = serviceOrder
      .filter((item) => item.parentId === parentId)
      .sort((left, right) => left.layer - right.layer || left.target - right.target);
    const desiredIds = ordered.map(({ nodeId }) => nodeId);
    let orderedCorrectly = false;
    for (let attempt = 0; attempt < 2 && !orderedCorrectly; attempt += 1) {
      const parent = await figma.getNodeByIdAsync(parentId);
      if (!hasSceneChildren(parent)) break;
      const currentIds = parent.children
        .slice(0, desiredIds.length)
        .map((node) => node.id);
      orderedCorrectly = desiredIds.every((id, index) => currentIds[index] === id);
      if (orderedCorrectly) break;

      for (const { nodeId } of [...ordered].reverse()) {
        const node = await figma.getNodeByIdAsync(nodeId);
        const freshParent = await figma.getNodeByIdAsync(parentId);
        if (
          !node || node.type === "DOCUMENT" || node.type === "PAGE" ||
          !isMotionNode(node) || !isLiveNode(node) || !hasSceneChildren(freshParent)
        ) {
          break;
        }
        try {
          freshParent.insertChild(0, node);
        } catch {
          // Retry the whole ordering pass with freshly resolved proxies.
          break;
        }
      }
    }
    const verifiedParent = await figma.getNodeByIdAsync(parentId);
    if (!hasSceneChildren(verifiedParent)) {
      throw new Error("Update verification failed: a source parent is unavailable.");
    }
    const verifiedOrder = verifiedParent.children
      .slice(0, desiredIds.length)
      .map((node) => node.id);
    if (!desiredIds.every((id, index) => verifiedOrder[index] === id)) {
      throw new Error("Update verification failed: service layers could not be ordered safely.");
    }
  }

  // Never report success for a split front track without its complete service
  // family. This catches real-Figma invalidation that mocks cannot reproduce.
  const verifiedPageNodes = findMarkedPageNodes();
  for (const targetId of changed) {
    const verifiedSource = await figma.getNodeByIdAsync(targetId);
    if (
      !verifiedSource || verifiedSource.type === "DOCUMENT" || verifiedSource.type === "PAGE" ||
      !isMotionNode(verifiedSource)
    ) {
      throw new Error("Update verification failed: a source layer is unavailable.");
    }
    const verifiedCopies = (await findBackCopies(
      verifiedSource,
      true,
      verifiedPageNodes,
    )).filter(isLiveNode);
    const expectedCopies = useDepthLayers ? layerCount - 1 : 0;
    if (verifiedCopies.length !== expectedCopies) {
      throw new Error(
        `Update verification failed for ${verifiedSource.name}: expected ${expectedCopies} service layer${expectedCopies === 1 ? "" : "s"}, found ${verifiedCopies.length}.`,
      );
    }
    const completeNodes = [verifiedSource, ...verifiedCopies];
    for (const verifiedNode of completeNodes) {
      if (!animatedFields.every((field) => Boolean(verifiedNode.manualKeyframeTracks[field]))) {
        throw new Error(`Update verification failed for ${verifiedSource.name}: incomplete animation tracks.`);
      }
    }
  }

  const containerMarker = {
    version: 2,
    preset: settings.preset,
    settings,
  } satisfies OrbitMarker;
  const refreshedSuccessfulTargets = (await Promise.all(
    changed.map((id) => figma.getNodeByIdAsync(id)),
  )).filter((target): target is MotionNode => Boolean(
    target && target.type !== "DOCUMENT" && target.type !== "PAGE" && isMotionNode(target),
  ));
  for (const container of collectRelaunchContainers(refreshedSuccessfulTargets)) {
    setOrbitRelaunch(container, containerMarker);
  }

  if (changed.length === 0) {
    throw new Error(failures[0] ?? "Figma Motion is unavailable for this selection.");
  }

  post({
    type: "result",
    kind: "success",
    message: failures.length > 0
      ? `Animated ${changed.length} layers; ${failures.length} could not be changed.`
      : `Animated ${changed.length} layer${changed.length === 1 ? "" : "s"}.`,
  });
  sendSelection();
}

async function clearMotion(_scope: TargetScope): Promise<void> {
  // Clear owns cleanup, not targeting. Selecting a parent must clear every
  // Orbit source and service descendant even if the UI currently says
  // Selection or an earlier preset stored a different scope.
  const scopedNodes = new Map<string, SceneNode>();
  const visit = (node: SceneNode): void => {
    scopedNodes.set(node.id, node);
    if (isOrbitService(node)) return;
    if (hasChildren(node)) {
      for (const child of node.children) visit(child);
    }
  };
  for (const selected of figma.currentPage.selection) visit(selected);

  const markedPageNodes = findMarkedPageNodes();
  const motionInScope = new Map<string, MotionNode>();
  const servicesInScope = new Map<string, MotionNode>();
  for (const node of scopedNodes.values()) {
    if (!isMotionNode(node)) continue;
    if (isOrbitService(node)) servicesInScope.set(node.id, node);
    else if (!isTimelineOwner(node)) motionInScope.set(node.id, node);
  }

  const orbitTargetsById = new Map<string, MotionNode>();
  for (const node of motionInScope.values()) {
    const marker = readOrbitMarker(node);
    if (marker && !isOrbitService(node)) {
      orbitTargetsById.set(node.id, node);
      continue;
    }
    const parent = tryGetParent(node);
    if (hasSceneChildren(parent) && parent.children.some((child) => (
      child.name.startsWith(`${node.name} · Orbit Depth `) && isServiceNamed(child)
    ))) {
      orbitTargetsById.set(node.id, node);
    }
  }

  // Recover sources whose marker was lost during an interrupted old Clear.
  for (const candidate of markedPageNodes) {
    const marker = readOrbitMarker(candidate);
    if (marker?.role !== "back" || !marker.sourceId) continue;
    const source = motionInScope.get(marker.sourceId);
    if (source) orbitTargetsById.set(source.id, source);
  }
  // Recover markerless legacy services by the exact generated name, but only
  // inside the selected subtree and beside an identically named source.
  for (const service of servicesInScope.values()) {
    if (readOrbitMarker(service)) continue;
    const sourceName = service.name.replace(/ · Orbit Depth \d+ \(service\)$/, "");
    const parent = tryGetParent(service);
    if (!hasSceneChildren(parent)) continue;
    const source = parent.children.find((child) => (
      child.name === sourceName && !isOrbitService(child) && isMotionNode(child)
    ));
    if (source && isMotionNode(source)) {
      motionInScope.set(source.id, source);
      orbitTargetsById.set(source.id, source);
    }
  }

  const orbitTargets = [...orbitTargetsById.values()];
  if (orbitTargets.length === 0 && servicesInScope.size === 0) {
    throw new Error("No Orbit Animator motion in the current selection.");
  }

  let cleared = 0;
  let failures = 0;
  const protectedServiceIds = new Set<string>();
  const removedServiceIds = new Set<string>();
  const orbitTargetIds = orbitTargets.map((node) => node.id);
  const serviceIdsInScope = [...servicesInScope.keys()];
  const relaunchContainerIds = new Set(
    [...collectRelaunchContainers(orbitTargets)].map((container) => container.id),
  );
  for (const selected of figma.currentPage.selection) {
    if (isSceneContainer(selected)) relaunchContainerIds.add(selected.id);
  }
  for (const nodeId of orbitTargetIds) {
    try {
      const resolved = await figma.getNodeByIdAsync(nodeId);
      if (
        !resolved || resolved.type === "DOCUMENT" || resolved.type === "PAGE" ||
        !isMotionNode(resolved)
      ) {
        failures += 1;
        continue;
      }
      const backCopies = await findBackCopies(resolved, true, markedPageNodes);
      const backCopyIds = backCopies.map((copy) => copy.id);
      const marker = readOrbitMarker(resolved);
      if (!clearAnimatedTracksSafely(resolved)) {
        for (const copyId of backCopyIds) protectedServiceIds.add(copyId);
        failures += 1;
        continue;
      }
      restoreSourceOpacity(resolved, marker);
      removeManagedFrontShadow(resolved);
      let removedEveryCopy = true;
      for (const copyId of backCopyIds) {
        const copy = await figma.getNodeByIdAsync(copyId);
        if (!copy) {
          removedServiceIds.add(copyId);
          continue;
        }
        if (copy.type === "DOCUMENT" || copy.type === "PAGE" || !isMotionNode(copy)) {
          removedEveryCopy = false;
          continue;
        }
        if (await removeNodeSafely(copy)) removedServiceIds.add(copyId);
        else removedEveryCopy = false;
      }
      if (!removedEveryCopy) {
        failures += 1;
        continue;
      }
      resolved.setPluginData(orbitMarkerKey, "");
      setOrbitRelaunch(resolved);
      cleared += 1;
    } catch {
      failures += 1;
    }
  }

  // Delete orphaned service layers contained by the selected parent. They may
  // have no surviving source marker, so source-driven cleanup cannot see them.
  for (const serviceId of serviceIdsInScope) {
    if (removedServiceIds.has(serviceId) || protectedServiceIds.has(serviceId)) continue;
    const service = await figma.getNodeByIdAsync(serviceId);
    if (!service) {
      removedServiceIds.add(serviceId);
      continue;
    }
    if (service.type !== "DOCUMENT" && service.type !== "PAGE" && isMotionNode(service) &&
      await removeNodeSafely(service)) {
      removedServiceIds.add(serviceId);
    } else {
      failures += 1;
    }
  }

  for (const containerId of relaunchContainerIds) {
    const container = await figma.getNodeByIdAsync(containerId);
    if (isSceneContainer(container)) syncContainerRelaunch(container);
  }
  if (failures > 0) {
    throw new Error(
      `Clear stopped before completing ${failures} layer${failures === 1 ? "" : "s"}. Run Clear again; unfinished Orbit data was preserved for recovery.`,
    );
  }

  // Clear must never report success while tracks or service copies survive.
  // Resolve every id again because removals can invalidate sibling proxies.
  const remainingMarkedNodes = findMarkedPageNodes();
  for (const nodeId of orbitTargetIds) {
    const source = await figma.getNodeByIdAsync(nodeId);
    if (!source) continue;
    if (source.type === "DOCUMENT" || source.type === "PAGE" || !isMotionNode(source)) {
      throw new Error("Clear verification failed: a source layer became unavailable.");
    }
    if (animatedFields.some((field) => Boolean(source.manualKeyframeTracks[field]))) {
      throw new Error(`Clear verification failed for ${source.name}: animation tracks remain.`);
    }
    if (readOrbitMarker(source)) {
      throw new Error(`Clear verification failed for ${source.name}: Orbit metadata remains.`);
    }
    const remainingCopies = (await findBackCopies(source, true, remainingMarkedNodes)).filter(isLiveNode);
    if (remainingCopies.length > 0) {
      throw new Error(
        `Clear verification failed for ${source.name}: ${remainingCopies.length} service layer${remainingCopies.length === 1 ? "" : "s"} remain.`,
      );
    }
  }
  for (const serviceId of serviceIdsInScope) {
    if (await figma.getNodeByIdAsync(serviceId)) {
      throw new Error("Clear verification failed: a service layer remains.");
    }
  }
  if (cleared === 0 && removedServiceIds.size === 0) {
    throw new Error("Orbit Animator could not clear motion from the selected layers.");
  }
  post({
    type: "result",
    kind: "success",
    message: `Cleared ${cleared} layer${cleared === 1 ? "" : "s"}.`,
  });
  sendSelection();
}

let operationInProgress = false;

figma.ui.onmessage = async (message: UiToPluginMessage) => {
  const startsOperation = message.type === "apply" || message.type === "clear";
  if (startsOperation && operationInProgress) return;
  if (startsOperation) operationInProgress = true;
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
  } finally {
    if (startsOperation) operationInProgress = false;
  }
};

figma.on("selectionchange", sendSelection);
sendSelection();
