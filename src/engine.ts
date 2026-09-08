import type {
  DialTransition,
  GeometryShape,
  MotionSettings,
  OpacityCurve,
  WaveFunction,
} from "./types";

export interface PointState {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  rotation: number;
}

export interface GeneratedKeyframe extends PointState {
  time: number;
}

export type DepthLayer = "front" | "back";

export function depthSplitOpacity(
  point: Pick<PointState, "z" | "opacity">,
  layer: DepthLayer,
): number {
  const isFront = point.z >= 0;
  return layer === "front" === isFront ? point.opacity : 0;
}

const TAU = Math.PI * 2;

export function supportsPathGeometry(shape: GeometryShape): boolean {
  return shape === "ellipse" || shape === "custom-path";
}

export function supportsOrbitOrientation(settings: MotionSettings["geometry"]): boolean {
  return settings.orient3d;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function fitPreviewFrame(
  frameWidth: number,
  frameHeight: number,
  maxWidth = 300,
  maxHeight = 220,
): { width: number; height: number } {
  const width = frameWidth > 0 ? frameWidth : 720;
  const height = frameHeight > 0 ? frameHeight : 400;
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

export function fitSettingsToFrame(
  settings: MotionSettings,
  frameWidth: number,
  frameHeight: number,
  itemWidth: number,
  itemHeight: number,
): MotionSettings {
  if (
    settings.geometry.dynamicScale === false ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    itemWidth <= 0 ||
    itemHeight <= 0
  ) return settings;

  const padding = Math.min(24, Math.min(frameWidth, frameHeight) * 0.06);
  const fitScale = Math.max(0.05, Math.min(
    settings.appearance.nearScale,
    (frameWidth - padding * 2) / itemWidth,
    (frameHeight - padding * 2) / itemHeight,
  ));
  const nearScale = Math.min(settings.appearance.nearScale, fitScale);
  const scaleRatio = settings.appearance.nearScale > 0
    ? nearScale / settings.appearance.nearScale
    : 1;
  const availableX = Math.max(0, (frameWidth - itemWidth * nearScale) / 2 - padding);
  const availableY = Math.max(0, (frameHeight - itemHeight * nearScale) / 2 - padding);
  let radiusX = availableX;
  let radiusY = availableY;
  if (
    settings.geometry.shape === "ellipse" ||
    supportsOrbitOrientation(settings.geometry)
  ) {
    const rotation = (settings.geometry.circleRotation ?? 0) * Math.PI / 180;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const boundsX = Math.hypot(radiusX * cosine, radiusY * sine);
    const boundsY = Math.hypot(radiusX * sine, radiusY * cosine);
    const fit = Math.min(
      boundsX > 0 ? availableX / boundsX : 1,
      boundsY > 0 ? availableY / boundsY : 1,
      1,
    );
    radiusX *= fit;
    radiusY *= fit;
  }

  return {
    ...settings,
    geometry: {
      ...settings.geometry,
      radiusX,
      radiusY,
    },
    appearance: {
      ...settings.appearance,
      nearScale,
      farScale: Math.max(0.05, settings.appearance.farScale * scaleRatio),
    },
  };
}

const opacityCurves: Record<OpacityCurve, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  early: [0, 0, 0.58, 1],
  late: [0.42, 0, 1, 1],
  soft: [0.37, 0, 0.63, 1],
  sharp: [0.85, 0, 0.15, 1],
};

function normalizedDepth(z: number, depth: number): number {
  if (depth <= 0) return 0.5;
  return clamp((z / depth + 1) / 2, 0, 1);
}

function customPathPoint(
  serialized: string,
  progress: number,
): { x: number; y: number; angle: number; closed: boolean } | null {
  let points: Array<[number, number]>;
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) return null;
    points = parsed.filter((point): point is [number, number] => (
      Array.isArray(point) && point.length === 2 &&
      typeof point[0] === "number" && typeof point[1] === "number" &&
      Number.isFinite(point[0]) && Number.isFinite(point[1])
    ));
  } catch {
    return null;
  }
  if (points.length < 2) return null;

  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    return { point, next, length: Math.hypot(next[0] - point[0], next[1] - point[1]) };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= Number.EPSILON) return null;
  let distance = clamp(progress, 0, 1) * total;
  let segment = segments[segments.length - 1];
  for (const candidate of segments) {
    if (distance <= candidate.length) {
      segment = candidate;
      break;
    }
    distance -= candidate.length;
  }
  const local = segment.length > 0 ? distance / segment.length : 0;
  return {
    x: segment.point[0] + (segment.next[0] - segment.point[0]) * local,
    y: segment.point[1] + (segment.next[1] - segment.point[1]) * local,
    angle: Math.atan2(segment.next[1] - segment.point[1], segment.next[0] - segment.point[0]),
    closed: Math.hypot(
      points[0][0] - points[points.length - 1][0],
      points[0][1] - points[points.length - 1][1],
    ) < 0.001,
  };
}

function rotatedEllipsePoint(
  angle: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
): { x: number; y: number; pathAngle: number } {
  const rotationRadians = rotation * Math.PI / 180;
  const localX = radiusX * Math.cos(angle);
  const localY = radiusY * Math.sin(angle);
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  return {
    x: localX * cosine - localY * sine,
    y: localX * sine + localY * cosine,
    pathAngle: Math.atan2(
      radiusY * Math.cos(angle),
      -radiusX * Math.sin(angle),
    ) + rotationRadians,
  };
}

function radicalInverseBase2(value: number): number {
  let index = Math.max(0, Math.floor(value));
  let inverse = 0;
  let fraction = 0.5;
  while (index > 0) {
    inverse += (index % 2) * fraction;
    index = Math.floor(index / 2);
    fraction *= 0.5;
  }
  return inverse;
}

function sphereSurfacePoint(
  index: number,
  count: number,
): { x: number; y: number; z: number } {
  const safeCount = Math.max(1, Math.floor(count));
  if (safeCount === 1) return { x: 0, y: 0, z: 1 };

  const safeIndex = ((Math.floor(index) % safeCount) + safeCount) % safeCount;
  const y = 1 - (2 * (safeIndex + 0.5)) / safeCount;
  const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
  const longitude = Math.PI / 4 + TAU * radicalInverseBase2(safeIndex);
  return {
    x: ringRadius * Math.cos(longitude),
    y,
    z: ringRadius * Math.sin(longitude),
  };
}

function waveValue(type: WaveFunction, angle: number): number {
  return type === "cos" ? Math.cos(angle) : Math.sin(angle);
}

function parametricCoordinates(
  angle: number,
  geometry: MotionSettings["geometry"],
): { x: number; y: number; z: number; pathAngle: number } {
  const degrees = (value: number) => value * Math.PI / 180;
  const xAngle = angle * geometry.xFrequency + degrees(geometry.xPhase);
  const yAngle = angle * geometry.yFrequency + degrees(geometry.yPhase);
  const depthAngle = angle * geometry.depthFrequency + degrees(geometry.depthPhase);
  const x = geometry.radiusX * geometry.xAmplitude * waveValue(geometry.xWave, xAngle);
  const y = geometry.radiusY * (
    geometry.yOffset + geometry.yAmplitude * waveValue(geometry.yWave, yAngle)
  );
  const z = geometry.depth * geometry.depthAmplitude * waveValue(geometry.depthWave, depthAngle);
  const epsilon = 0.0001;
  const nextX = geometry.radiusX * geometry.xAmplitude * waveValue(
    geometry.xWave,
    xAngle + epsilon * geometry.xFrequency,
  );
  const nextY = geometry.radiusY * (
    geometry.yOffset + geometry.yAmplitude * waveValue(
      geometry.yWave,
      yAngle + epsilon * geometry.yFrequency,
    )
  );
  return { x, y, z, pathAngle: Math.atan2(nextY - y, nextX - x) };
}

export function pointForGeometry(
  angle: number,
  settings: MotionSettings,
  index = 0,
  count = 1,
): PointState {
  const {
    radiusX: rx,
    radiusY: ry,
    depth,
    tilt,
    rotation,
    shapeAmount,
    itemSpread,
    depthFalloff,
  } = settings.geometry;
  const safeDepthFalloff = Math.max(0.01, depthFalloff);
  const circleRotation = settings.geometry.circleRotation ?? 0;
  const tiltRad = (tilt * Math.PI) / 180;
  const safeCount = Math.max(1, count);
  const itemPhase = safeCount > 1 ? (index / safeCount) * TAU : 0;
  const staggerPhase = (settings.motion.stagger * index / settings.motion.duration) * TAU;
  const globalAngle = angle - itemPhase - staggerPhase;
  const cycle = ((angle / TAU) % 1 + 1) % 1;
  let x = 0;
  let y = 0;
  let z = 0;
  let pathAngle = 0;
  let presetRotation = 0;
  let scaleXMultiplier = 1;
  let scaleYMultiplier = 1;
  let opacityMultiplier = 1;
  let orbitPlaneScaleY = ry;

  const parametric = parametricCoordinates(angle, settings.geometry);
  x = parametric.x;
  y = parametric.y;
  z = parametric.z;
  pathAngle = parametric.pathAngle;

  switch (settings.geometry.shape) {
    case "sphere": {
      const spherePoint = sphereSurfacePoint(index, safeCount);
      const cosine = Math.cos(globalAngle);
      const sine = Math.sin(globalAngle);
      const screenRadius = Math.min(rx, ry);
      orbitPlaneScaleY = screenRadius;
      const rotatedX = spherePoint.x * cosine + spherePoint.z * sine;
      const rotatedZ = -spherePoint.x * sine + spherePoint.z * cosine;
      x = screenRadius * rotatedX;
      y = screenRadius * spherePoint.y;
      z = depth * rotatedZ;
      pathAngle = Math.atan2(
        screenRadius * rotatedZ,
        0.001,
      );
      break;
    }
    case "deck": {
      const offset = Math.atan2(Math.sin(angle), Math.cos(angle)) / TAU * safeCount;
      const distance = Math.abs(offset);
      x = offset * rx * 0.22 * itemSpread +
        Math.sign(offset) * Math.min(distance, 1) * rx * 0.16 * shapeAmount;
      y = distance * ry * 0.025 * itemSpread;
      z = depth * (1 - Math.min(distance / (3.4 * safeDepthFalloff), 1) * 2);
      scaleXMultiplier = 0.66 + Math.exp(-distance * 1.8 / safeDepthFalloff) * 0.38;
      scaleYMultiplier = 0.72 + Math.exp(-distance * 1.8 / safeDepthFalloff) * 0.32;
      opacityMultiplier = clamp(
        (safeCount / 2 - distance) / Math.min(1, safeCount / 2),
        0,
        1,
      );
      break;
    }
    case "shuffle": {
      const lift = Math.sin(cycle * Math.PI);
      x = Math.sin(cycle * TAU) * rx * 0.55 * lift * shapeAmount;
      y = -ry * 0.38 * lift * shapeAmount + index * ry * 0.006 * itemSpread;
      z = depth * Math.cos(cycle * TAU);
      presetRotation = Math.sin(cycle * TAU) * 18 * shapeAmount;
      pathAngle = cycle * TAU;
      break;
    }
    case "tunnel": {
      const radius = 0.1 + cycle * 0.9 * shapeAmount;
      const spiral = angle * (1 + shapeAmount);
      x = Math.cos(spiral) * rx * 0.72 * radius;
      y = Math.sin(spiral) * ry * 0.72 * radius;
      z = depth * (cycle * 2 - 1);
      scaleXMultiplier = scaleYMultiplier = 0.42 + cycle * 0.58;
      opacityMultiplier = Math.sin(cycle * Math.PI) ** 0.35;
      pathAngle = spiral + Math.PI / 2;
      break;
    }
    case "cylinder":
      x = Math.sin(angle) * rx * 0.72 * shapeAmount;
      y = (index % 3 - 1) * ry * 0.35 * itemSpread;
      z = depth * Math.cos(angle);
      pathAngle = Math.PI / 2;
      break;
    case "racetrack": {
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      x = Math.sign(cosine) * rx * 0.82 * shapeAmount * Math.sqrt(Math.abs(cosine));
      y = Math.sign(sine) * ry * 0.45 * shapeAmount * Math.sqrt(Math.abs(sine));
      z = depth * sine;
      pathAngle = Math.atan2(
        cosine / Math.max(Math.sqrt(Math.abs(sine)), 0.2),
        -sine / Math.max(Math.sqrt(Math.abs(cosine)), 0.2),
      );
      break;
    }
    case "fan": {
      const open = 0.5 - 0.5 * Math.cos(globalAngle);
      const slot = index - (safeCount - 1) / 2;
      const normalizedSlot = slot / Math.max((safeCount - 1) / 2, 1);
      const directionSign = settings.motion.direction === "clockwise" ? 1 : -1;
      x = normalizedSlot * directionSign * rx * 0.75 * open * shapeAmount;
      y = Math.abs(normalizedSlot) * ry * 0.22 * open * shapeAmount +
        index * ry * 0.004 * itemSpread;
      z = depth * (1 - Math.abs(normalizedSlot) * 1.5) * open;
      presetRotation = -normalizedSlot * directionSign * 34 * open * shapeAmount;
      scaleXMultiplier = scaleYMultiplier = 0.82 + open * 0.12;
      break;
    }
    case "pendulum": {
      const swing = Math.sin(globalAngle + index * 0.055 * itemSpread) * 0.82 * shapeAmount;
      x = Math.sin(swing) * rx * 0.72;
      y = -ry * 0.45 + Math.cos(swing) * ry * 0.8 +
        (index - (safeCount - 1) / 2) * ry * 0.035 * itemSpread;
      z = depth * (index / Math.max(safeCount - 1, 1) * 2 - 1);
      presetRotation = swing * 40;
      pathAngle = swing;
      break;
    }
    case "vortex": {
      const pulse = 0.5 + 0.5 * Math.sin(globalAngle * 2 + itemPhase);
      const radius = 0.28 + pulse * 0.72 * shapeAmount;
      x = Math.cos(angle * 2) * rx * radius;
      y = Math.sin(angle * 2) * ry * 0.7 * radius;
      z = depth * Math.sin(angle);
      pathAngle = angle * 2 + Math.PI / 2;
      break;
    }
    case "focus-deck": {
      const offset = Math.atan2(Math.sin(angle), Math.cos(angle)) / TAU * safeCount;
      const distance = Math.abs(offset);
      x = clamp(offset, -3, 3) * rx * 0.22 * itemSpread;
      y = Math.min(distance, 3) * ry * 0.07 * shapeAmount;
      z = depth * (1 - Math.min(distance / (3 * safeDepthFalloff), 1) * 2);
      scaleXMultiplier = scaleYMultiplier = 0.76 +
        Math.exp(-distance * 1.5 / safeDepthFalloff) * 0.24;
      opacityMultiplier = clamp(
        (safeCount / 2 - distance) / Math.min(1, safeCount / 2),
        0,
        1,
      );
      presetRotation = -offset * 2;
      break;
    }
    case "ellipse":
    case "custom-path":
    case "parametric":
      break;
  }

  if (settings.geometry.shape === "ellipse") {
    const ellipse = rotatedEllipsePoint(
      angle,
      rx,
      ry,
      settings.geometry.orient3d ? 0 : circleRotation,
    );
    x = ellipse.x;
    y = ellipse.y;
    pathAngle = ellipse.pathAngle;
  } else if (settings.geometry.shape === "custom-path") {
    const pathProgress = cycle;
    const custom = customPathPoint(settings.geometry.customPath, pathProgress);
    if (custom) {
      x = (custom.x - 0.5) * 2 * rx;
      y = (custom.y - 0.5) * 2 * ry;
      pathAngle = custom.angle;
      if (!custom.closed) {
        opacityMultiplier *= Math.min(
          clamp(pathProgress / 0.08, 0, 1),
          clamp((1 - pathProgress) / 0.08, 0, 1),
        );
      }
    }
  }

  if (supportsOrbitOrientation(settings.geometry)) {
    const depthOnCanvas = depth > 0 ? (z / depth) * orbitPlaneScaleY : 0;
    const tiltedY = y * Math.cos(tiltRad) - depthOnCanvas * Math.sin(tiltRad);
    const tiltedDepth = y * Math.sin(tiltRad) + depthOnCanvas * Math.cos(tiltRad);
    y = tiltedY;
    z = orbitPlaneScaleY > 0 ? (tiltedDepth / orbitPlaneScaleY) * depth : 0;

    const orbitRotation = circleRotation * Math.PI / 180;
    const rotatedX = x * Math.cos(orbitRotation) - y * Math.sin(orbitRotation);
    const rotatedY = x * Math.sin(orbitRotation) + y * Math.cos(orbitRotation);
    x = rotatedX;
    y = rotatedY;
    pathAngle += orbitRotation;
  }

  const d = normalizedDepth(z, Math.max(depth, 1));
  const scale = settings.appearance.farScale +
    d * (settings.appearance.nearScale - settings.appearance.farScale);
  const fadeStart = clamp(
    Math.min(settings.appearance.fadeStart, settings.appearance.fadeEnd) / 100,
    0,
    1,
  );
  const fadeEnd = clamp(
    Math.max(settings.appearance.fadeStart, settings.appearance.fadeEnd) / 100,
    0,
    1,
  );
  const fadeProgress = fadeEnd - fadeStart < Number.EPSILON
    ? Number(d >= fadeEnd)
    : clamp((d - fadeStart) / (fadeEnd - fadeStart), 0, 1);
  const easedOpacity = transitionProgress(
    fadeProgress,
    {
      type: "easing",
      duration: 1,
      ease: opacityCurves[settings.appearance.opacityCurve],
    },
  );
  const opacity = settings.appearance.farOpacity +
    easedOpacity * (1 - settings.appearance.farOpacity);
  const rotationValue = settings.geometry.shape === "deck"
    ? 0
    : presetRotation + (settings.appearance.facePath
      ? (pathAngle * 180) / Math.PI + rotation
      : rotation * Math.sin(angle));

  return {
    x,
    y,
    z,
    scaleX: clamp(scale * scaleXMultiplier, 0.05, 4),
    scaleY: clamp(scale * scaleYMultiplier, 0.05, 4),
    opacity: clamp(opacity * opacityMultiplier, 0, 1),
    rotation: rotationValue,
  };
}

export function generateNodeKeyframes(
  settings: MotionSettings,
  index: number,
  count: number,
): GeneratedKeyframe[] {
  const samples = clamp(Math.round(settings.motion.keyframes), 4, 48);
  const direction = settings.motion.direction === "clockwise" ? 1 : -1;
  const itemPhase = count > 1 ? (index / count) * TAU : 0;
  const staggerPhase = (settings.motion.stagger * index / settings.motion.duration) * TAU;
  const result: GeneratedKeyframe[] = [];

  for (let sample = 0; sample <= samples; sample += 1) {
    const progress = sample / samples;
    const cycleProgress = transitionProgress(progress, settings.motion.fullCycle);
    const angle = itemPhase + staggerPhase +
      direction * cycleProgress * TAU * settings.geometry.turns;
    result.push({
      time: progress * settings.motion.duration,
      ...pointForGeometry(angle, settings, index, count),
    });
  }

  return result;
}

function cubic(value: number, a: number, b: number, c: number, d: number): number {
  const inverse = 1 - value;
  return inverse ** 3 * a +
    3 * inverse ** 2 * value * b +
    3 * inverse * value ** 2 * c +
    value ** 3 * d;
}

function cubicBezierProgress(
  progress: number,
  [x1, y1, x2, y2]: [number, number, number, number],
): number {
  let low = 0;
  let high = 1;
  let parameter = progress;

  for (let iteration = 0; iteration < 14; iteration += 1) {
    parameter = (low + high) / 2;
    const x = cubic(parameter, 0, x1, x2, 1);
    if (x < progress) low = parameter;
    else high = parameter;
  }

  return cubic(parameter, 0, y1, y2, 1);
}

function springProgress(progress: number, bounce: number): number {
  if (progress <= 0 || progress >= 1) return progress;
  const safeBounce = clamp(bounce, 0, 1);
  const decay = 7.5 - safeBounce * 2.5;
  const frequency = 8 + safeBounce * 9;
  const raw = 1 - Math.exp(-decay * progress) *
    (Math.cos(frequency * progress) + 0.18 * Math.sin(frequency * progress));
  const end = 1 - Math.exp(-decay) *
    (Math.cos(frequency) + 0.18 * Math.sin(frequency));
  return raw / end;
}

export function transitionProgress(progress: number, transition: DialTransition): number {
  const safeProgress = clamp(progress, 0, 1);
  if (safeProgress === 0 || safeProgress === 1) return safeProgress;
  if (transition.type === "spring") {
    return springProgress(safeProgress, transition.bounce ?? 0.25);
  }
  if (Array.isArray(transition.ease) && transition.ease.length === 4) {
    return cubicBezierProgress(safeProgress, transition.ease);
  }
  return safeProgress;
}

const lerp = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;

export function sampleGeneratedKeyframes(
  frames: GeneratedKeyframe[],
  time: number,
  transition: DialTransition,
  hold = false,
): PointState {
  if (frames.length === 0) {
    return { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, opacity: 1, rotation: 0 };
  }
  if (frames.length === 1 || time <= frames[0].time) return frames[0];
  const last = frames[frames.length - 1];
  if (time >= last.time) return last;

  let index = 0;
  while (index < frames.length - 2 && time >= frames[index + 1].time) index += 1;
  const from = frames[index];
  const to = frames[index + 1];
  const local = (time - from.time) / Math.max(to.time - from.time, Number.EPSILON);
  const eased = hold ? 0 : transitionProgress(local, transition);

  return {
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased),
    z: lerp(from.z, to.z, eased),
    scaleX: lerp(from.scaleX, to.scaleX, eased),
    scaleY: lerp(from.scaleY, to.scaleY, eased),
    opacity: lerp(from.opacity, to.opacity, eased),
    rotation: lerp(from.rotation, to.rotation, eased),
  };
}
