/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface Entity {
  x: number;
  y: number;
  width: number;
  height: number;
}

export enum ObstacleType {
  STANDARD = "STANDARD",
  OSCILLATING = "OSCILLATING",
  DASH = "DASH",
  ZIGZAG = "ZIGZAG",
  SPIKE = "SPIKE",
  ROTATING_BAR = "ROTATING_BAR",
  GOLDEN_FLAG = "GOLDEN_FLAG",
}

export enum PowerUpType {
  SHIELD = "SHIELD",
  SPEED_BOOST = "SPEED_BOOST",
}

export interface Obstacle extends Entity {
  id: number;
  speed: number;
  type: ObstacleType;
  startY: number;
  phase: number;
  verticalSpeed: number;
  amplitude: number;
  isCeiling?: boolean;
  iconKey?: string;
}

export interface PowerUp extends Entity {
  id: number;
  type: PowerUpType;
  speed: number;
}

export interface GameState {
  score: number;
  highScore: number;
  isGameOver: boolean;
  isPlaying: boolean;
  playerY: number;
  playerTargetY: number;
  obstacles: Obstacle[];
  volume: number;
  pitch: number;
}

export enum GameStatus {
  IDLE = "IDLE",
  PAUSED = "PAUSED",
  PLAYING = "PLAYING",
  GAMEOVER = "GAMEOVER",
  WON = "WON",
  PREPARING = 'PREPARING',
}