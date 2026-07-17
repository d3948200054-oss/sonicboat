/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { GameStatus, Obstacle, ObstacleType, PowerUp, PowerUpType } from "../types";
import { COLORS, GAME_CONFIG } from "../constants";
import { AudioService } from "../services/audioService";
import { LEVELS, LEVEL_THRESHOLDS, TOTAL_GAME_DISTANCE } from "../levels";
import { ICON_PATHS, IconFlag, IconMic, IconSettings, IconClose } from "./Icons";
import { ICON_D, ICON_FRAME, ICON_OBSTACLES_POOL, type IconKey } from "./IconsCanvas";
import useAudio from "../hooks/useAudio";
import { getPath } from "../utils/path";
import useRAF from "../hooks/useRAF";

interface CavePoint {
  x: number;
  ceilingY: number;
  floorY: number;
}

interface GameCanvasProps {
  status: GameStatus;
  onGameOver: (progress: number) => void;
  onWin: (progress: number) => void;
  micStream: MediaStream | null;
  godMode?: boolean;
  isMicSimulated?: boolean;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ status, onGameOver, onWin, micStream, godMode, isMicSimulated }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioServiceRef = useRef<AudioService>(new AudioService());
  const hasInitializedDimensionsRef = useRef(false);
  const { playForeground, preloadCache } = useAudio();
  const [isAudioReady, setIsAudioReady] = useState(false);

  useEffect(() => {
    const setupAudio = async () => {
      if (status === GameStatus.PLAYING && micStream) {
        const success = await audioServiceRef.current.init(micStream);
        if (success) {
          setIsAudioReady(true);
        }
      } else if (status === GameStatus.PAUSED) {
        audioServiceRef.current.stop();
      }
    };
    
    setupAudio();
  }, [status, micStream]);

  const audioFiles = [
    getPath("/media/audio/sfx/sonicbot/breakobstacle.mp3"),
    getPath("/media/audio/sfx/sonicbot/powerup.mp3"),
    getPath("/media/audio/sfx/global/lose.mp3"),
    getPath("/media/audio/sfx/global/win.mp3"),
  ];

  useEffect(() => {
    preloadCache(audioFiles);
  }, []);

  const mascotPathRef = useRef<Path2D | null>(null);

  // HUD Refs (Used for Direct DOM manipulation to keep bar smooth)
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressMarkerRef = useRef<HTMLDivElement>(null);

  // Scaling Refs
  const scaleRef = useRef(1);
  const logicalWidthRef = useRef(GAME_CONFIG.MIN_GAME_WIDTH);
  const logicalHeightRef = useRef(GAME_CONFIG.MIN_GAME_HEIGHT);

  const distanceRef = useRef(0);
  const levelIndexRef = useRef(0);
  const lastPowerUpDistanceRef = useRef(-GAME_CONFIG.POWERUP_SPAWN_RATE);
  const lastFloorSpikeDistanceRef = useRef(0);
  const playerYRef = useRef(0);
  const playerVelocityYRef = useRef(0);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const powerUpsRef = useRef<PowerUp[]>([]);

  const goalReachedRef = useRef(false);
  const flagSpawnedRef = useRef(false);

  // Cave Refs
  const cavePointsRef = useRef<CavePoint[]>([]);
  const caveTargetYRef = useRef(0);
  const caveHeightRef = useRef(GAME_CONFIG.CAVE_INITIAL_HEIGHT);

  const activeShieldRef = useRef(false);
  const activeBoostRef = useRef({ active: false, endTime: 0 });
  const isDyingRef = useRef(false);

  const physicsConfigRef = useRef({
    gravity: GAME_CONFIG.GRAVITY,
    thrust: GAME_CONFIG.THRUST,
  });

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [physicsState, setPhysicsState] = useState({
    gravity: GAME_CONFIG.GRAVITY,
    thrust: GAME_CONFIG.THRUST,
  });

  const debugVolumeRef = useRef(0);
  const isDebugPressedRef = useRef(false);

  const lastSpawnTimeRef = useRef(0);
  const speedRef = useRef(GAME_CONFIG.BASE_SPEED);
  const particlesRef = useRef<
    {
      x: number;
      y: number;
      life: number;
      color?: string | CanvasPattern;
      strokeStyle?: string | CanvasPattern;
      size?: number;
      vx?: number;
      vy?: number;
      drag?: number;
    }[]
  >([]);


  const iconPathCacheRef = useRef<Record<string, Path2D>>({});
  const iconPoolRef = useRef<IconKey[]>([]);

  const getIconPath = (key: IconKey) => {
    if (!iconPathCacheRef.current[key]) {
      iconPathCacheRef.current[key] = new Path2D(ICON_D[key]);
    }
    return iconPathCacheRef.current[key];
  };

  const getNextIconKey = useCallback((): IconKey => {
    if (iconPoolRef.current.length === 0) {
      const keys = [...ICON_OBSTACLES_POOL];
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      iconPoolRef.current = keys;
    }
    return iconPoolRef.current.pop()!;
  }, []);

  const drawVectorIconExact = (
    ctx: CanvasRenderingContext2D,
    key: IconKey,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => {
    const path = getIconPath(key);
    const f = ICON_FRAME[key];
    const s = Math.min(dw / f.w, dh / f.h);

    const pad = 1.8;
    const scale = s * pad;

    ctx.save();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    ctx.translate(dx + dw / 2, dy + dh / 2);
    ctx.scale(scale, scale);
    ctx.rotate(dw * .001 + dx/logicalWidthRef.current)

    ctx.translate(-f.x - f.w / 2, -f.y - f.h / 2);

    ctx.fillStyle = COLORS.OBSTACLE_COLOR;

    ctx.fill(path, "evenodd");
    ctx.restore();

    // draw hitboxes
    if(GAME_CONFIG.DRAW_HITBOXES) {
    ctx.strokeStyle='red';
    ctx.strokeRect(dx,dy,dw,dh);
    }
  };

  const trailHistoryRef = useRef<{ y: number; time: number }[]>([]);

  const initCave = (width: number, height: number) => {
    const points: CavePoint[] = [];
    const segmentWidth = GAME_CONFIG.CAVE_SEGMENT_WIDTH;
    const numPoints = Math.ceil(width / segmentWidth) + 2;

    caveTargetYRef.current = height / 2;
    caveHeightRef.current = GAME_CONFIG.CAVE_INITIAL_HEIGHT;

    for (let i = 0; i < numPoints; i++) {
      points.push({
        x: i * segmentWidth,
        ceilingY: caveTargetYRef.current - caveHeightRef.current / 2,
        floorY: caveTargetYRef.current + caveHeightRef.current / 2,
      });
    }
    cavePointsRef.current = points;
  };

  const generateNewCavePoint = (canvasHeight: number) => {
    if (cavePointsRef.current.length === 0) return { x: 0, ceilingY: 0, floorY: 0 };
    const lastPoint = cavePointsRef.current[cavePointsRef.current.length - 1];

    // Wander targetY
    const wander = (Math.random() - 0.5) * 2 * GAME_CONFIG.CAVE_WANDER_SPEED;
    const padding = 100 + caveHeightRef.current / 2;
    caveTargetYRef.current = Math.max(
      padding,
      Math.min(canvasHeight - padding, caveTargetYRef.current + wander)
    );

    // Smoothly shift current cave height toward the current level's target height
    const currentLevelConfig = LEVELS[levelIndexRef.current];
    const targetHeight = currentLevelConfig.caveHeight;
    const heightShiftSpeed = 0.03; // Smoothing factor
    caveHeightRef.current += (targetHeight - caveHeightRef.current) * heightShiftSpeed;

    return {
      x: lastPoint.x + GAME_CONFIG.CAVE_SEGMENT_WIDTH,
      ceilingY: caveTargetYRef.current - caveHeightRef.current / 2,
      floorY: caveTargetYRef.current + caveHeightRef.current / 2,
    };
  };

  const resetGame = useCallback(() => {
    const height = logicalHeightRef.current;
    const width = logicalWidthRef.current;

    distanceRef.current = 0;
    levelIndexRef.current = 0;
    lastPowerUpDistanceRef.current = -GAME_CONFIG.POWERUP_SPAWN_RATE;
    lastFloorSpikeDistanceRef.current = 0;
    playerYRef.current = height / 2;
    playerVelocityYRef.current = 0;
    obstaclesRef.current = [];
    powerUpsRef.current = [];
    activeShieldRef.current = false;
    activeBoostRef.current = { active: false, endTime: 0 };
    speedRef.current = GAME_CONFIG.BASE_SPEED;
    lastSpawnTimeRef.current = performance.now();
    particlesRef.current = [];
    trailHistoryRef.current = [];
    goalReachedRef.current = false;
    flagSpawnedRef.current = false;
    isDyingRef.current = false;

    initCave(width, height);

    if (progressBarRef.current) progressBarRef.current.style.width = "0%";
    if (progressMarkerRef.current) progressMarkerRef.current.style.left = "0%";
  }, []);

  const getWeightedObstacleType = (): ObstacleType => {
    const weights = LEVELS[levelIndexRef.current].obstacleWeights;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (const [type, weight] of Object.entries(weights)) {
      if (random < weight) return type as ObstacleType;
      random -= weight;
    }

    return ObstacleType.STANDARD; // Fallback
  };

  const spawnPowerUp = useCallback((canvasWidth: number, canvasHeight: number) => {
    if (goalReachedRef.current) return;
    const spawnYBase = caveTargetYRef.current;
    const spawnRange = caveHeightRef.current * 0.6;
    const types = [PowerUpType.SHIELD, PowerUpType.SPEED_BOOST];
    const type = types[Math.floor(Math.random() * types.length)];
    const size = GAME_CONFIG.POWERUP_SIZE;
    const newPowerUp: PowerUp = {
      id: Date.now() + Math.random(),
      x: canvasWidth,
      y: spawnYBase + (Math.random() - 0.5) * spawnRange,
      width: size,
      height: size,
      type,
      speed: speedRef.current,
    };
    powerUpsRef.current.push(newPowerUp);
  }, []);

  const spawnFloorSpike = useCallback((canvasWidth: number, canvasHeight: number) => {
    if (goalReachedRef.current) return;

    const height = Math.random() * 40 + 60;
    const width = 40;
    const offset = 8;

    let startY = 0;
    let startX = canvasWidth;

    if (cavePointsRef.current.length > 0) {
      const lastPoint = cavePointsRef.current[cavePointsRef.current.length - 1];
      startX = lastPoint.x;
      startY = lastPoint.floorY - height + offset;
    } else {
      const currentFloorY = caveTargetYRef.current + caveHeightRef.current / 2;
      startY = currentFloorY - height + offset;
    }

    const newObstacle: Obstacle = {
      id: Date.now() + Math.random(),
      x: startX,
      y: startY,
      startY,
      width,
      height,
      speed: speedRef.current,
      type: ObstacleType.SPIKE,
      phase: Math.random(),
      verticalSpeed: 0,
      amplitude: 0,
      isCeiling: false,
    };
    obstaclesRef.current.push(newObstacle);
  }, []);

  const spawnObstacle = useCallback((canvasWidth: number, canvasHeight: number) => {
    if (goalReachedRef.current) return;
    const spawnYBase = caveTargetYRef.current;
    const spawnRange = caveHeightRef.current * 0.6;

    const type = getWeightedObstacleType();
    let width = GAME_CONFIG.OBSTACLE_WIDTH;
    let height = width;
    let speed = speedRef.current;
    let startY = spawnYBase + (Math.random() - 0.5) * spawnRange;
    let startX = canvasWidth;
    let amplitude = 0;
    let vSpeed = 0;
    let isCeiling = undefined;

    if (type === ObstacleType.OSCILLATING) {
      // height = 60;
      amplitude = 80 + Math.random() * 40;
      vSpeed = 0.015 + Math.random() * 0.015;
    } else if (type === ObstacleType.DASH) {
      speed *= 1.5;
      width = GAME_CONFIG.OBSTACLE_WIDTH * 1.5;
      // height = 40;
    } else if (type === ObstacleType.ZIGZAG) {
      vSpeed = 2 + Math.random() * 2;
    } else if (type === ObstacleType.SPIKE) {
      isCeiling = Math.random() > 0.5;
      // height = Math.random() * 40 + 60;
      width = 40;
      const offset = 8;
      if (cavePointsRef.current.length > 0) {
        const lastPoint = cavePointsRef.current[cavePointsRef.current.length - 1];
        startX = lastPoint.x;
        startY = isCeiling ? lastPoint.ceilingY - offset : lastPoint.floorY - height + offset;
      } else {
        const currentCeilingY = caveTargetYRef.current - caveHeightRef.current / 2;
        const currentFloorY = caveTargetYRef.current + caveHeightRef.current / 2;
        startY = isCeiling ? currentCeilingY - offset : currentFloorY - height + offset;
      }
    } else if (type === ObstacleType.ROTATING_BAR) {
      width = 25;
      height = 450;
      startY = startY;
    }

    const iconKey = getNextIconKey();

    const newObstacle: Obstacle = {
      id: Date.now() + Math.random(),
      x: startX,
      y: startY,
      startY,
      width,
      height,
      speed,
      type,
      phase: Math.random(),
      verticalSpeed: vSpeed,
      amplitude,
      isCeiling,
      iconKey,
    };
    obstaclesRef.current.push(newObstacle);
  }, []);

  const spawnGoldenFlag = useCallback((canvasWidth: number, canvasHeight: number) => {
    const flagObstacle: Obstacle = {
      id: Date.now(),
      x: canvasWidth + 200,
      y: caveTargetYRef.current,
      startY: caveTargetYRef.current,
      width: 60,
      height: 120,
      speed: speedRef.current,
      type: ObstacleType.GOLDEN_FLAG,
      phase: 0,
      verticalSpeed: 0,
      amplitude: 0,
    };
    obstaclesRef.current.push(flagObstacle);
    flagSpawnedRef.current = true;
  }, []);

  const createBurst = (x: number, y: number, color: string | CanvasPattern) => {
    for (let i = 0; i < 15; i++) {
      particlesRef.current.push({
        x,
        y,
        life: 1,
        color,
        size: Math.random() * 8 + 4,
        vx: (Math.random() - 0.5) * 15,
        vy: (Math.random() - 0.5) * 15,
        drag: 0.01,
      });
    }
  };

  const drawCave = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (cavePointsRef.current.length === 0) return;
    ctx.save();
    ctx.fillStyle = COLORS.ACCENT;
    ctx.beginPath();
    ctx.moveTo(cavePointsRef.current[0].x, 0);
    for (const p of cavePointsRef.current) ctx.lineTo(p.x, p.ceilingY);
    ctx.lineTo(cavePointsRef.current[cavePointsRef.current.length - 1].x, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cavePointsRef.current[0].x, height);
    for (const p of cavePointsRef.current) ctx.lineTo(p.x, p.floorY);
    ctx.lineTo(cavePointsRef.current[cavePointsRef.current.length - 1].x, height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const drawRocketExhaust = (
    ctx: CanvasRenderingContext2D,
    currentX: number,
    history: { y: number; time: number }[],
    size: number,
    effectiveSpeed: number,
    isBoost: boolean
  ) => {
    // return;
    if (history.length < 2) return;
    ctx.save();
    const now = performance.now();

    let minX = currentX;
    for (const point of history) {
      const x = currentX - (now - point.time) * effectiveSpeed * 0.05;
      if (x < minX) minX = x;
    }

    if(gradientPattern.current) {
      const matrix = new DOMMatrix();
      matrix.translate(currentX, playerYRef.current);
      matrix.scale(10,10);

      gradientPattern.current.setTransform(matrix);
      ctx.fillStyle = gradientPattern.current;
    } else {
      ctx.fillStyle = "white";
    }

    for (let i = history.length - 2; i >= 0; i--) {
      const point = history[i];
      const age = now - point.time;
      const x = currentX - age * effectiveSpeed * 0.05 +20;
      const opacity = Math.max(0, 1 - age / 800);
      if (opacity <= 0) continue;

      const baseSize = Math.min(size * 0.8 * opacity, 40);
      const offsetY = point.y + size * 0.5;
      const y = offsetY;

      ctx.globalAlpha = opacity * 0.1;

      ctx.beginPath();
      ctx.arc(x, offsetY, baseSize * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const drawMascot = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    time: number
  ) => {
    if (!mascotPathRef.current) mascotPathRef.current = new Path2D(ICON_PATHS.android_wave);
    const isBoost = activeBoostRef.current.active && time < activeBoostRef.current.endTime;

    // Normalize based on actual mascot path height (approx 85) to ensure it stays within size bounds
    const pathHeight = 110;
    const pathWidth = 120;
    const scale = size / pathHeight;

    ctx.save();
    // Centering within the logical size box
    ctx.translate(x + size / 2, y + size / 2);
    if(isDyingRef.current) {
      ctx.rotate(playerVelocityYRef.current/2);
    } else {
      ctx.rotate(Math.sin(playerVelocityYRef.current/10));
    }
    ctx.scale(1, 1);
    ctx.translate(-size / 2, -size / 2);

    // Shield
    if (activeShieldRef.current) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.65 + Math.sin(time / 200) * 5, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.SHIELD_BLUE;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // New Mascot Path (Android Character)
    ctx.save();
    // Center the mascot path visually within the logical area
    ctx.translate((size - pathWidth * scale) / 2, (size - pathHeight * scale) / 2 - 10);
    ctx.scale(scale, scale);
    if (isBoost) {
      ctx.shadowBlur = 15;
      ctx.shadowColor = COLORS.BOOST_WHITE;
    }
    ctx.fillStyle = "#fff";
    ctx.fill(mascotPathRef.current, "evenodd");
    ctx.restore();

    ctx.restore();
  };

  /**
   * Helper to get cave boundaries at a specific X coordinate.
   */
  const getCaveBoundariesAtX = (targetX: number, canvasHeight: number) => {
    let ceilingY = 0;
    let floorY = canvasHeight;

    if (cavePointsRef.current.length === 0) return { ceilingY, floorY };

    // Find the segment containing targetX
    for (let i = 0; i < cavePointsRef.current.length - 1; i++) {
      const p1 = cavePointsRef.current[i];
      const p2 = cavePointsRef.current[i + 1];
      if (targetX >= p1.x && targetX <= p2.x) {
        const t = (targetX - p1.x) / (p2.x - p1.x);
        ceilingY = p1.ceilingY + (p2.ceilingY - p1.ceilingY) * t;
        floorY = p1.floorY + (p2.floorY - p1.floorY) * t;
        return { ceilingY, floorY };
      }
    }

    // Fallback if targetX is out of range of current cavePoints
    const lastPoint = cavePointsRef.current[cavePointsRef.current.length - 1];
    if (targetX > lastPoint.x) {
      return { ceilingY: lastPoint.ceilingY, floorY: lastPoint.floorY };
    }
    const firstPoint = cavePointsRef.current[0];
    return { ceilingY: firstPoint.ceilingY, floorY: firstPoint.floorY };
  };

  const gradientPattern = useRef<CanvasPattern>(null);
  const gradientImageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    if (!gradientImageRef.current)return;
    const img = gradientImageRef.current;
    if (!img.width)return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if(!tempCtx)return;
    tempCanvas.width = img.width * 2;
    tempCanvas.height = img.height * 2;
    tempCtx.drawImage(img, 0,0,img.width,img.height);
    tempCtx.save(); {
      tempCtx.translate(img.width*2,0);
      tempCtx.scale(-1,1);
      tempCtx.drawImage(img, 0,0,img.width,img.height);
    }
    tempCtx.restore();
    tempCtx.save(); {
      tempCtx.translate(0,img.height*2);
      tempCtx.scale(1,-1);
      tempCtx.drawImage(img, 0,0,img.width,img.height);
    }
    tempCtx.restore(); {
      tempCtx.translate(img.width*2,img.height*2);
      tempCtx.scale(-1,-1);
      tempCtx.drawImage(img, 0,0,img.width,img.height);
    }
    gradientPattern.current = ctx.createPattern(tempCanvas, 'repeat');
  })

  const update = useCallback(
    (time: number) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const logicalWidth = logicalWidthRef.current;
      const logicalHeight = logicalHeightRef.current;
      const scale = scaleRef.current;

      // Draw Gradient Background
      ctx.save();
      const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bgGradient.addColorStop(0, COLORS.BG_TOP);
      bgGradient.addColorStop(1, COLORS.BG_BOTTOM);
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();


      // Begin Logical Drawing
      ctx.save();
      ctx.scale(scale, scale);

      //draw mountains
      const distance = distanceRef.current||0;
      const mountainParalax = 0.5;
      const mountainWidth = 1039;
      const mountainCount = 3;
      const mountainWrapDistance = Math.max(logicalWidth, mountainWidth * (mountainCount + 1));
      const mountainSpacing = mountainWrapDistance / mountainCount;
      const mountainY = logicalHeight;
      const mountainPaths = [getIconPath("mountain1"), getIconPath("mountain2")];
      const mountainHeights = [625, 448];
      ctx.fillStyle="#131313"
      ctx.globalAlpha = 0.5;
      for(let i=0;i<mountainCount;i++) {
        ctx.save();
        const x = (distance * mountainParalax) + (i *mountainSpacing);
        const mountainType = i % mountainPaths.length;
        ctx.translate(logicalWidth-(x % mountainWrapDistance),mountainY-mountainHeights[mountainType]);
        ctx.fill(mountainPaths[mountainType]);
        ctx.restore();
      };
      ctx.globalAlpha = 1.0;

      speedRef.current += GAME_CONFIG.SPEED_INCREMENT;
      const isBoostActive = activeBoostRef.current.active && time < activeBoostRef.current.endTime;
      const effectiveSpeed = isBoostActive ? speedRef.current * 1.5 : speedRef.current;

      const { volume: micVolume } = audioServiceRef.current.getAudioData();
      if (isDebugPressedRef.current) {
        debugVolumeRef.current = Math.min(
          debugVolumeRef.current + 0.005,
          GAME_CONFIG.VOLUME_SENSITIVITY * 1.5
        );
      } else {
        debugVolumeRef.current = Math.max(debugVolumeRef.current - 0.01, 0);
      }
      const volume = Math.max(micVolume, debugVolumeRef.current);
      const volPercent = isDyingRef.current ? 0 : Math.min(Math.max(volume / GAME_CONFIG.VOLUME_SENSITIVITY, 0), 1);

      if ((status === GameStatus.PLAYING && micStream) || (status === GameStatus.PLAYING && isMicSimulated)) {
        distanceRef.current += effectiveSpeed;

        if (distanceRef.current >= TOTAL_GAME_DISTANCE) {
          goalReachedRef.current = true;
          if (!flagSpawnedRef.current) {
            spawnGoldenFlag(logicalWidth, logicalHeight);
          }
        }

        if (levelIndexRef.current < LEVELS.length - 1) {
          const threshold = LEVEL_THRESHOLDS[levelIndexRef.current];
          if (distanceRef.current >= threshold) {
            levelIndexRef.current++;
          }
        }

        for (const p of cavePointsRef.current) {
          p.x -= effectiveSpeed;
        }

        if (
          cavePointsRef.current.length > 0 &&
          cavePointsRef.current[0].x < -GAME_CONFIG.CAVE_SEGMENT_WIDTH
        ) {
          cavePointsRef.current.shift();
        }
        while (
          cavePointsRef.current[cavePointsRef.current.length - 1]?.x <
          logicalWidth + GAME_CONFIG.CAVE_SEGMENT_WIDTH
        ) {
          cavePointsRef.current.push(generateNewCavePoint(logicalHeight));
        }
      }

      const playerX = logicalWidth * 0.25 - GAME_CONFIG.PLAYER_SIZE / 2;

      if (status === GameStatus.PLAYING) {
        playerVelocityYRef.current +=
          physicsConfigRef.current.gravity - volPercent * physicsConfigRef.current.thrust;
        playerVelocityYRef.current *= GAME_CONFIG.DRAG;
        const terminalVel = GAME_CONFIG.TERMINAL_VELOCITY;
        playerVelocityYRef.current = Math.max(
          Math.min(playerVelocityYRef.current, terminalVel),
          -terminalVel
        );
        playerYRef.current += playerVelocityYRef.current;


        const playerCenterX = playerX + GAME_CONFIG.PLAYER_SIZE / 2;
        const { ceilingY: ceilingCollisionY, floorY: floorCollisionY } = getCaveBoundariesAtX(
          playerCenterX,
          logicalHeight
        );

        // Player Boundary Clamp - Adjusted padding for cleaner visual separation
        const padding = 5;
        if(!isDyingRef.current) {
          if (playerYRef.current < ceilingCollisionY + padding) {
            playerYRef.current = ceilingCollisionY + padding;
            if (playerVelocityYRef.current < 0) playerVelocityYRef.current *= -0.5;
          } else if (playerYRef.current + GAME_CONFIG.PLAYER_SIZE > floorCollisionY - padding) {
            playerYRef.current = floorCollisionY - GAME_CONFIG.PLAYER_SIZE - padding;
            if (playerVelocityYRef.current > 0) playerVelocityYRef.current *= -0.5;
          }
        }

        trailHistoryRef.current.push({ y: playerYRef.current, time: performance.now() });
        if (trailHistoryRef.current.length > 40) trailHistoryRef.current.shift();

        const currentLevel = LEVELS[levelIndexRef.current];
        const adjustedSpawnRate =
          (GAME_CONFIG.SPAWN_RATE / currentLevel.spawnRateModifier) / (effectiveSpeed / 4);
        if (
          !goalReachedRef.current &&
          distanceRef.current - lastPowerUpDistanceRef.current >= GAME_CONFIG.POWERUP_SPAWN_RATE
        ) {
          spawnPowerUp(logicalWidth, logicalHeight);
          lastPowerUpDistanceRef.current = distanceRef.current;
        }

        if (
          !goalReachedRef.current && time - lastSpawnTimeRef.current > adjustedSpawnRate &&
          distanceRef.current - lastPowerUpDistanceRef.current > 80 &&
          distanceRef.current - lastPowerUpDistanceRef.current < GAME_CONFIG.POWERUP_SPAWN_RATE - 80
        ) {
          spawnObstacle(logicalWidth, logicalHeight);
          lastSpawnTimeRef.current = time;
        }

        if (
          !goalReachedRef.current &&
          distanceRef.current - lastFloorSpikeDistanceRef.current >=
            GAME_CONFIG.FLOOR_SPIKE_SPAWN_RATE
        ) {
          spawnFloorSpike(logicalWidth, logicalHeight);
          lastFloorSpikeDistanceRef.current = distanceRef.current;
        }

        if (Math.random() < volPercent) {
          particlesRef.current.push({
            x: playerX+GAME_CONFIG.PLAYER_SIZE/4,
            y: playerYRef.current + (0.5+Math.random()) * GAME_CONFIG.PLAYER_SIZE,
            life: 1,
            color: isBoostActive ? COLORS.BOOST_WHITE : gradientPattern.current || COLORS.BOOST_WHITE,
            strokeStyle: "#000",
            size: 2+Math.random() * (4 + volPercent * 8),
            vx: -(Math.random() * 5 + 8),
            vy: (Math.random() - 0.5) * 4 - playerVelocityYRef.current/2,
            drag: 0.05,
          });
        }

        powerUpsRef.current = powerUpsRef.current.filter(pu => {
          pu.x -= effectiveSpeed;

          // Power-up boundary safety (keep them in cave)
          const puCenterX = pu.x + pu.width / 2;
          const { ceilingY: cY, floorY: fY } = getCaveBoundariesAtX(puCenterX, logicalHeight);
          if (pu.y < cY) pu.y = cY + 5;
          if (pu.y + pu.height > fY) pu.y = fY - pu.height - 5;

          const hitBoxPadding = 5;
          const collision =
            playerX + hitBoxPadding < pu.x + pu.width &&
            playerX + GAME_CONFIG.PLAYER_SIZE * 2 - hitBoxPadding > pu.x &&
            playerYRef.current + hitBoxPadding < pu.y + pu.height &&
            playerYRef.current + GAME_CONFIG.PLAYER_SIZE * 1.5 - hitBoxPadding > pu.y;
          if (collision) {
            playForeground(getPath("/media/audio/sfx/sonicbot/powerup.mp3"));
            let pColor = COLORS.PINK_100;
            if (pu.type === PowerUpType.SHIELD) {
              activeShieldRef.current = true;
              pColor = COLORS.SHIELD_BLUE;
            } else if (pu.type === PowerUpType.SPEED_BOOST) {
              activeBoostRef.current = {
                active: true,
                endTime: time + GAME_CONFIG.POWERUP_DURATION,
              };
              pColor = COLORS.BOOST_WHITE;
            }
            createBurst(pu.x + pu.width / 2, pu.y + pu.height / 2, pColor);
            return false;
          }
          return pu.x + pu.width > 0;
        });

        obstaclesRef.current = obstaclesRef.current.filter(obs => {
          obs.x -= effectiveSpeed * (obs.type === ObstacleType.DASH ? 1.5 : 1);

          const obsCenterX = obs.x + obs.width / 2;
          const { ceilingY: obsCeilingY, floorY: obsFloorY } = getCaveBoundariesAtX(
            obsCenterX,
            logicalHeight
          );

          if (obs.type === ObstacleType.OSCILLATING) {
            obs.phase += obs.verticalSpeed;
            obs.y = obs.startY + Math.sin(obs.phase) * obs.amplitude;

            // Constrain oscillating obstacle within cave
            if (obs.y < obsCeilingY) obs.y = obsCeilingY;
            if (obs.y + obs.height > obsFloorY) obs.y = obsFloorY - obs.height;
          } else if (obs.type === ObstacleType.ZIGZAG) {
            obs.y += obs.verticalSpeed;
            // Bounce off cave boundaries instead of canvas edges
            if (obs.y <= obsCeilingY || obs.y + obs.height >= obsFloorY) {
              obs.verticalSpeed *= -1;
              obs.y = Math.max(obsCeilingY, Math.min(obsFloorY - obs.height, obs.y));
            }
          } else if (obs.type === ObstacleType.ROTATING_BAR) {
            const rotSpeed =
              GAME_CONFIG.ROTATING_BAR_MIN_SPEED +
              volPercent *
                (GAME_CONFIG.ROTATING_BAR_MAX_SPEED - GAME_CONFIG.ROTATING_BAR_MIN_SPEED);
            obs.phase += rotSpeed;
            // Ensure bar center stays roughly in path
            if (obs.y < obsCeilingY + 50) obs.y = obsCeilingY + 50;
            if (obs.y > obsFloorY - 50) obs.y = obsFloorY - 50;
          } else if (obs.type === ObstacleType.SPIKE) {
            // Anchor spike to dynamic ceiling/floor
            const offset = 8;
            if (obs.isCeiling) {
              obs.y = obsCeilingY - offset;
            } else {
              obs.y = obsFloorY - obs.height + offset;
            }
          } else {
            // Standard and Dash: Keep them within the flight corridor
            if (obs.y < obsCeilingY) obs.y = obsCeilingY;
            if (obs.y + obs.height > obsFloorY) obs.y = obsFloorY - obs.height;
          }

          let obsCollision = false;
          if (obs.type === ObstacleType.ROTATING_BAR) {
            const px = playerX + GAME_CONFIG.PLAYER_SIZE / 2;
            const py = playerYRef.current + GAME_CONFIG.PLAYER_SIZE / 2;
            const dx = px - obs.x;
            const dy = py - obs.y;

            const cos = Math.cos(-obs.phase);
            const sin = Math.sin(-obs.phase);
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;

            const barHalfWidth = obs.width / 2 + 15;
            const barHalfHeight = obs.height / 2 + 15;
            if (Math.abs(rx) < barHalfWidth && Math.abs(ry) < barHalfHeight) {
              obsCollision = true;
            }
          } else if (obs.type === ObstacleType.GOLDEN_FLAG) {
            obsCollision = playerX + GAME_CONFIG.PLAYER_SIZE >= obs.x;
            if (obsCollision) {
              playForeground(getPath("/media/audio/sfx/global/win.mp3"));
              onWin(distanceRef.current);
              return false;
            }
          } else {
            obsCollision =
              playerX + 10 < obs.x + obs.width &&
              playerX + GAME_CONFIG.PLAYER_SIZE - 10 > obs.x &&
              playerYRef.current + 10 < obs.y + obs.height &&
              playerYRef.current + GAME_CONFIG.PLAYER_SIZE - 10 > obs.y;
          }

          if (obsCollision && obs.type !== ObstacleType.GOLDEN_FLAG) {
            if (activeShieldRef.current || godMode) {
              activeShieldRef.current = false;
              playForeground(getPath("/media/audio/sfx/sonicbot/breakobstacle.mp3"));
              createBurst(obs.x+obs.width/2, obs.y+obs.height/2, obs.type === ObstacleType.SPIKE ? COLORS.ACCENT : gradientPattern.current || COLORS.BOOST_WHITE);
              return false;
            } else {
              playerVelocityYRef.current = 0;
              playForeground(getPath("/media/audio/sfx/sonicbot/breakobstacle.mp3"));
              createBurst(obs.x+obs.width/2, obs.y+obs.height/2, obs.type === ObstacleType.SPIKE ? COLORS.ACCENT : gradientPattern.current || COLORS.BOOST_WHITE);
              isDyingRef.current = true;
              speedRef.current = 0;
              setTimeout(() => {
                playForeground(getPath("/media/audio/sfx/global/lose.mp3"));
                onGameOver(distanceRef.current);
              }, 1000)
              return false;
            }
          }
          return obs.x + obs.width + obs.height > 0;
        });

        // Direct Ref Update: Keeps the UI smooth without state re-renders
        if (progressBarRef.current) {
          const progressPercent = Math.min((distanceRef.current / TOTAL_GAME_DISTANCE) * 100, 100);
          progressBarRef.current.style.width = `${progressPercent}%`;
        }

        particlesRef.current.forEach(p => {
          p.life -= isBoostActive ? 0.05 : 0.03;
          p.x += p.vx || -effectiveSpeed;
          p.y += p.vy || 0;
          if(p.drag && p.vx && p.vy) {
            p.vx *= (1-p.drag);
            p.vy *= (1-p.drag);
          }
        });
        particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      }

      // DRAWING SEQUENCE - Moved drawCave to the end for masking
      
      particlesRef.current.forEach(p => {
        ctx.fillStyle = p.color || COLORS.TRAIL;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size || 3, 0, Math.PI * 2);
        ctx.fill();
        if(p.strokeStyle) {
          ctx.strokeStyle = p.strokeStyle;
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1.0;

      powerUpsRef.current.forEach(pu => {
        ctx.save();
        const centerX = pu.x + pu.width / 2;
        const centerY = pu.y + pu.height / 2;
        const pulse = Math.sin(time / 200) * 4;
        const radius = pu.width / 2 + pulse;

        let color = COLORS.PINK_100;
        let iconPathStr = "";
        let iconScale = 1;
        if (pu.type === PowerUpType.SHIELD) {
          color = COLORS.SHIELD_BLUE;
          iconPathStr = ICON_PATHS.shield;
          iconScale = 0.24;
        } else if (pu.type === PowerUpType.SPEED_BOOST) {
          color = COLORS.BOOST_WHITE;
          iconPathStr = ICON_PATHS.speed_boost;
          iconScale = 0.24;
        }

        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.scale(iconScale, iconScale);
        ctx.translate(-45, -56);
        const path = new Path2D(iconPathStr);
        if (gradientPattern.current) {
          ctx.fillStyle = gradientPattern.current;
        } else {
          ctx.fillStyle = color;
        }
        ctx.fill(path);
        ctx.restore();
        ctx.restore();
      });

      obstaclesRef.current.forEach(obs => {
        ctx.save();
        if (obs.type === ObstacleType.SPIKE) {
          const isCeiling = obs.isCeiling;
          ctx.fillStyle = COLORS.ACCENT;
          ctx.beginPath();
          if (isCeiling) {
            ctx.moveTo(obs.x, obs.y);
            ctx.lineTo(obs.x + obs.width, obs.y);
            ctx.lineTo(obs.x + obs.width / 2  + (obs.phase-0.5+0.2)*obs.width, obs.y + obs.height);
          } else {
            ctx.moveTo(obs.x, obs.y + obs.height);
            ctx.lineTo(obs.x + obs.width, obs.y + obs.height);
            ctx.lineTo(obs.x + obs.width / 2 + (obs.phase-0.5)*obs.width, obs.y);
          }
          ctx.closePath();
          ctx.fill();
        } else if (obs.type === ObstacleType.ROTATING_BAR) {
          const iconColor = "#000";
          ctx.translate(obs.x, obs.y);
          ctx.rotate(obs.phase);
          ctx.fillStyle = COLORS.BOOST_WHITE;
          ctx.shadowBlur = 20;
          ctx.shadowColor = "#FFFFFF";
          ctx.beginPath();
          ctx.roundRect(-obs.width / 2, -obs.height / 2, obs.width, obs.height, obs.width / 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = COLORS.BOOST_WHITE;
          ctx.beginPath();
          ctx.arc(0, 0, 30, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.strokeStyle = iconColor;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = iconColor;
          ctx.beginPath();
          ctx.roundRect(-8, -15, 16, 25, 8);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(0, 5, 12, 0, Math.PI, false);
          ctx.strokeStyle = iconColor;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, 15);
          ctx.lineTo(0, 22);
          ctx.stroke();
        } else if (obs.type === ObstacleType.GOLDEN_FLAG) {
          ctx.save();
          ctx.translate(obs.x, obs.y - obs.height / 2);
          ctx.fillStyle = COLORS.BOOST_WHITE;
          ctx.fillRect(0, 0, 5, obs.height);
          ctx.fillStyle = COLORS.BOOST_WHITE;
          ctx.beginPath();
          ctx.moveTo(5, 0);
          ctx.lineTo(obs.width, obs.height / 3);
          ctx.lineTo(5, obs.height / 2);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 20;
          ctx.shadowColor = COLORS.BOOST_WHITE;
          ctx.strokeStyle = "white";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        } else {
          if (obs.type === ObstacleType.DASH) {
            ctx.fillStyle = COLORS.BOOST_WHITE;
            ctx.shadowBlur = 10 + Math.sin(time / 150) * 10;
            ctx.shadowColor = COLORS.PINK_100;
          } else if (obs.type === ObstacleType.OSCILLATING) {
            ctx.fillStyle = COLORS.BOOST_WHITE;
            ctx.strokeStyle = COLORS.ACCENT;
            ctx.lineWidth = 2;
          } else if (obs.type === ObstacleType.ZIGZAG) {
            ctx.fillStyle = COLORS.BOOST_WHITE;
            ctx.globalAlpha = 0.6;
          } else {
            ctx.fillStyle = COLORS.ACCENT;
          }

          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;

          const key = (obs as any).iconKey as IconKey | undefined;

          if (key) {
            drawVectorIconExact(ctx, key, obs.x, obs.y, obs.width, obs.height);
          } else {
            ctx.fillStyle = COLORS.ACCENT;
            ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
          }
        }
        ctx.restore();
      });

      // MASKING LAYER - Draw the cave last so it masks anything that crosses the boundaries
      drawCave(ctx, logicalWidth, logicalHeight);
      drawRocketExhaust(
        ctx,
        playerX + 10,
        trailHistoryRef.current,
        GAME_CONFIG.PLAYER_SIZE,
        effectiveSpeed,
        isBoostActive
      );
      drawMascot(ctx, playerX, playerYRef.current, GAME_CONFIG.PLAYER_SIZE, time);

      ctx.restore();
    },
    [
      status,
      onGameOver,
      onWin,
      spawnObstacle,
      spawnPowerUp,
      spawnGoldenFlag,
      spawnFloorSpike,
      godMode,
      isMicSimulated,
    ]
  );

  const requestRef = useRAF(update, [status, micStream]);

  useEffect(() => {
    if (!containerRef.current) return;

      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          if (canvasRef.current) {
            const width = entry.contentRect.width;
            const height = entry.contentRect.height-100;
            canvasRef.current.width = width;
            canvasRef.current.height = height;

          const scale = Math.min(
            width / GAME_CONFIG.MIN_GAME_WIDTH,
            height / GAME_CONFIG.MIN_GAME_HEIGHT
          );

          const newLW = width / scale;
          const newLH = height / scale;

          if (
            hasInitializedDimensionsRef.current &&
            (newLW !== logicalWidthRef.current || newLH !== logicalHeightRef.current)
          ) {
            const diffX = (newLW - logicalWidthRef.current) * 0.25;
            const diffY = (newLH - logicalHeightRef.current) / 2;

            playerYRef.current += diffY;
            caveTargetYRef.current += diffY;
            // ... (rest of your existing shift logic)
          }

          scaleRef.current = scale;
          logicalWidthRef.current = newLW;
          logicalHeightRef.current = newLH;

          if (status === GameStatus.IDLE || !hasInitializedDimensionsRef.current) {
            resetGame();
            if (width > 0 && height > 0) {
              hasInitializedDimensionsRef.current = true;
            }
          }
        }
      }
    });

    observer.observe(containerRef.current);
    
    // --- CHANGE HERE: Only init if we are playing and have a stream ---
    if (status === GameStatus.PLAYING && micStream) {
      audioServiceRef.current.init(micStream);
    }

    return () => {
      observer.disconnect();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      // Ensure stop() handles the stream track closure for Firefox
      audioServiceRef.current.stop();
    };
  }, [update, status, resetGame, micStream]); // Add micStream to dependencies

  useEffect(() => {
    if (status === GameStatus.IDLE || status === GameStatus.GAMEOVER || status === GameStatus.WON) {
      resetGame();
    }
  }, [status, resetGame]);

  // Target the portal element with JS to override the 'flex-shrink-0' limitation
  useEffect(() => {
    const portalTarget = document.getElementById('footer-portal-target');
    if (portalTarget) {
      // Force growth
      portalTarget.style.flex = "1";
      portalTarget.style.width = "100%";
      portalTarget.style.display = "flex";
      portalTarget.style.alignItems = "center";
      portalTarget.style.justifyContent = "center";
      // Added 16px gap to the right on desktop, only if screen is large
      if (window.innerWidth >= 768) {
        portalTarget.style.marginRight = "16px";
      } else {
        portalTarget.style.marginRight = "0px";
      }
    }
  }, []);

  return (
    <div ref={containerRef} className="fixed relative w-full h-full overflow-hidden bg-black">
      <canvas ref={canvasRef} className="block absolute" />
      
      {/* Portal Implementation inside GameCanvas */}
      <div className="fixed bottom-[20px] md:bottom-[48px] left-[120px] right-[120px] z-[10] flex flex-col md:flex-row items-center justify-center md:justify-between gap-3 md:gap-4 pointer-events-none px-6 md:px-[60px] pointer-events-auto flex-shrink-0">
        <div
          className="rainbow-border-2 [--gradient-angle:60deg] flex-1 min-w-[370px] h-full rounded-full items-center justify-center px-5 py-2 flex gap-[10px] pointer-events-auto"
          style={{backgroundSize: "120% 800%", backgroundPositionX: "80%"}}
        >
          <div className="h-[5px] bg-[#37383B] backdrop-blur-md rounded-full shadow-lg pointer-events-none flex-1 overflow-hidden relative">
            <div
              ref={progressBarRef}
              className="h-full rounded-full bg-[#fff] transition-[width] duration-300 ease-out"
              style={{ width: "0%" }}
            />
          </div>
          <div className="text-[#fff] flex-shrink-0">
            <IconFlag size={20} />
          </div>
        </div>
      </div>

      {(GAME_CONFIG.DEV_ENABLED || isMicSimulated) && (
          <button
            className="absolute bottom-32 left-8 z-50 bg-black text-white hover:bg-gray-900 font-mono text-xs px-6 py-4 rounded-full border border-white/20 select-none backdrop-blur-md transition-all active:scale-95 shadow-xl flex items-center"
            onMouseDown={() => {
              isDebugPressedRef.current = true;
            }}
            onMouseUp={() => {
              isDebugPressedRef.current = false;
            }}
            onMouseLeave={() => {
              isDebugPressedRef.current = false;
            }}
            onTouchStart={e => {
              e.preventDefault();
              isDebugPressedRef.current = true;
            }}
            onTouchEnd={e => {
              e.preventDefault();
              isDebugPressedRef.current = false;
            }}
          >
            <IconMic size={16} className="mr-2" />
            {isMicSimulated ? "Hold to fly" : "Hold to scream"}
          </button>
      )}

      {GAME_CONFIG.DEV_ENABLED && (
        <>
          <button
            className="absolute bottom-8 right-8 z-50 bg-black text-white hover:bg-gray-900 font-mono text-xs px-6 py-4 rounded-full border border-white/20 select-none backdrop-blur-md transition-all active:scale-95 shadow-xl flex items-center"
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          >
            <IconSettings size={16} className="mr-2" />
            Adjust physics
          </button>
          <div
            className={`absolute bottom-0 left-0 right-0 bg-black/95 backdrop-blur-xl border-t border-white/10 p-10 transition-transform duration-300 ease-in-out z-40 rounded-t-[2.5rem] ${isDrawerOpen ? "translate-y-0" : "translate-y-full"}`}
          >
            <div className="max-w-xl mx-auto space-y-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-white font-bold tracking-widest text-sm uppercase">
                  Physics tuning
                </h3>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="text-white/50 hover:text-white transition-colors"
                >
                  <IconClose />
                </button>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between text-xs font-mono text-white/70">
                  <span>Gravity</span>
                  <span>{physicsState.gravity.toFixed(4)}</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1.0"
                  step="0.01"
                  value={physicsState.gravity}
                  className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setPhysicsState(prev => ({ ...prev, gravity: val }));
                    physicsConfigRef.current.gravity = val;
                  }}
                />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between text-xs font-mono text-white/70">
                  <span>Thrust</span>
                  <span>{physicsState.thrust.toFixed(4)}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="2.0"
                  step="0.05"
                  value={physicsState.thrust}
                  className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setPhysicsState(prev => ({ ...prev, thrust: val }));
                    physicsConfigRef.current.thrust = val;
                  }}
                />
              </div>
            </div>
            <div className="h-12"></div>
          </div>
        </>
      )}
      <img ref={gradientImageRef} src={getPath("/media/images/builds/google_gradient_tiny.png")} className="hidden"/>
    </div>
  );
};

export default GameCanvas;