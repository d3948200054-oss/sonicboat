/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { ObstacleType } from './types';

export interface LevelConfig {
  name: string;
  obstacleWeights: Record<ObstacleType, number>;
  spawnRateModifier: number; // Multiplier for the base spawn rate
  caveHeight: number;        // Target height for the cave in this level
  distance: number;          // Distance (pixels) to travel in this level
}

export const LEVELS: LevelConfig[] = [
  {
    name: "beginning",
    obstacleWeights: {
      [ObstacleType.STANDARD]: 1,
      [ObstacleType.OSCILLATING]: 1,
      [ObstacleType.DASH]: 1,
      [ObstacleType.ZIGZAG]: 1,
      [ObstacleType.SPIKE]: 1.0,
      [ObstacleType.ROTATING_BAR]: 0,
      // Fix: Added missing GOLDEN_FLAG to satisfy Record<ObstacleType, number> type requirement
      [ObstacleType.GOLDEN_FLAG]: 0,
    },
    spawnRateModifier: 1.0,
    caveHeight: 500,
    distance: 5000,
  },
  {
    name: "rotating bar",
    obstacleWeights: {
      [ObstacleType.STANDARD]: 0,
      [ObstacleType.OSCILLATING]: 0,
      [ObstacleType.DASH]: 0,
      [ObstacleType.ZIGZAG]: 0,
      [ObstacleType.SPIKE]: 0,
      [ObstacleType.ROTATING_BAR]: 1,
      // Fix: Added missing GOLDEN_FLAG to satisfy Record<ObstacleType, number> type requirement
      [ObstacleType.GOLDEN_FLAG]: 0,
    },
    spawnRateModifier: 0.25,
    caveHeight: 400,
    distance: 3600,
  },
  {
    name: "The Spike Gauntlet",
    obstacleWeights: {
      [ObstacleType.STANDARD]: .5,
      [ObstacleType.OSCILLATING]: 0.5,
      [ObstacleType.DASH]: 0.5,
      [ObstacleType.ZIGZAG]: 0.5,
      [ObstacleType.SPIKE]: 1.0,
      [ObstacleType.ROTATING_BAR]: 0,
      // Fix: Added missing GOLDEN_FLAG to satisfy Record<ObstacleType, number> type requirement
      [ObstacleType.GOLDEN_FLAG]: 0,
    },
    spawnRateModifier: 1.0,
    caveHeight: 300,
    distance: 3000,
  },
];

export const TOTAL_GAME_DISTANCE = LEVELS.reduce((sum, level) => sum + level.distance, 0);

export const LEVEL_THRESHOLDS = LEVELS.reduce((acc, level, i) => {
  const prev = i > 0 ? acc[i - 1] : 0;
  acc.push(prev + level.distance);
  return acc;
}, [] as number[]);
