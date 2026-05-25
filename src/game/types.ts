import type Phaser from 'phaser';

export type FactionId = 'land' | 'ocean';
export type MoveLayer = 'ground' | 'air' | 'surface' | 'deepsea';
export type Terrain = 'grass' | 'forest' | 'shore' | 'water' | 'deepwater' | 'reef';
export type UnitRole = 'worker' | 'scout' | 'soldier' | 'siege' | 'base';

export interface UnitDefinition {
  id: string;
  name: string;
  emoji: string;
  faction: FactionId;
  role: UnitRole;
  moveLayer: MoveLayer;
  cost: number;
  maxHp: number;
  speed: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  sight: number;
  buildTime: number;
  constructionTime?: number;
  gatherRate?: number;
  supply: number;
  description: string;
}

export interface UnitEntity {
  id: number;
  def: UnitDefinition;
  faction: FactionId;
  x: number;
  y: number;
  hp: number;
  radius: number;
  selected: boolean;
  targetX?: number;
  targetY?: number;
  attackTargetId?: number;
  resourceTargetId?: number;
  carrying: number;
  attackTimer: number;
  produceTimer: number;
  productionQueue: string[];
  underConstruction: boolean;
  buildProgress: number;
  builderId?: number;
  label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Arc;
  hpBar: Phaser.GameObjects.Rectangle;
  carryLabel: Phaser.GameObjects.Text;
}

export interface ResourceNode {
  id: number;
  type: 'berries' | 'kelp';
  x: number;
  y: number;
  amount: number;
  layer: MoveLayer;
  label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Arc;
}

export interface FactionState {
  id: FactionId;
  food: number;
  baseUnitId: number;
}
