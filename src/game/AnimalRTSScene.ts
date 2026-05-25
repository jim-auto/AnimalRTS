import Phaser from 'phaser';
import { AI_PRODUCTION, PLAYER_PRODUCTION, UNIT_DEFS } from './unitCatalog';
import type { FactionId, FactionState, MoveLayer, ResourceNode, Terrain, UnitEntity } from './types';

const TILE = 64;
const MAP_W = 48;
const MAP_H = 32;
const WORLD_W = TILE * MAP_W;
const WORLD_H = TILE * MAP_H;
const PLAYER: FactionId = 'land';
const ENEMY: FactionId = 'ocean';
const ENEMY_AI_INTERVAL = 3;
const ENEMY_FIRST_WAVE_DELAY = 58;
const ENEMY_WAVE_INTERVAL = 34;

export class AnimalRTSScene extends Phaser.Scene {
  private terrain: Terrain[][] = [];
  private units = new Map<number, UnitEntity>();
  private resources = new Map<number, ResourceNode>();
  private factions = new Map<FactionId, FactionState>();
  private nextUnitId = 1;
  private nextResourceId = 1;
  private selectedIds = new Set<number>();
  private terrainGfx!: Phaser.GameObjects.Graphics;
  private fogGfx!: Phaser.GameObjects.Graphics;
  private selectionGfx!: Phaser.GameObjects.Graphics;
  private attackTargetRings = new Map<number, Phaser.GameObjects.Arc>();
  private explored = new Set<string>();
  private visible = new Set<string>();
  private dragStart?: Phaser.Math.Vector2;
  private cameraKeys?: Record<string, Phaser.Input.Keyboard.Key>;
  private pendingBuildType?: string;
  private gameOver = false;
  private aiTimer = 0;
  private waveTimer = 0;
  private wavesLaunched = 0;
  private initialPlayerArmySize = 0;
  private hasGatheredFood = false;
  private hasIssuedReefAttack = false;
  private logTimer = 0;
  private minimapCtx!: CanvasRenderingContext2D;
  private outcomeShown = false;
  private hud = {
    resources: document.querySelector<HTMLDivElement>('#resources')!,
    selection: document.querySelector<HTMLDivElement>('#selection-body')!,
    production: document.querySelector<HTMLDivElement>('#production')!,
    mission: document.querySelector<HTMLOListElement>('#mission-list')!,
    minimap: document.querySelector<HTMLCanvasElement>('#minimap')!,
    outcome: document.querySelector<HTMLDivElement>('#outcome')!,
    outcomeTitle: document.querySelector<HTMLHeadingElement>('#outcome-title')!,
    outcomeBody: document.querySelector<HTMLParagraphElement>('#outcome-body')!,
    restart: document.querySelector<HTMLButtonElement>('#restart-button')!,
    log: document.querySelector<HTMLDivElement>('#log')!
  };

  constructor() {
    super('AnimalRTSScene');
  }

  create(): void {
    this.minimapCtx = this.hud.minimap.getContext('2d')!;
    this.hud.outcome.hidden = true;
    this.hud.restart.onclick = () => window.location.reload();
    this.hud.minimap.onclick = (event) => this.centerCameraFromMinimap(event);

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.centerOn(760, 900);
    this.input.mouse?.disableContextMenu();
    this.cameraKeys = this.input.keyboard?.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;

    this.buildTerrain();
    this.terrainGfx = this.add.graphics();
    this.drawTerrain();
    this.selectionGfx = this.add.graphics().setDepth(80);
    this.fogGfx = this.add.graphics().setDepth(120);

    const den = this.spawnUnit('den', 380, 880, PLAYER);
    const reef = this.spawnUnit('reefNest', 1910, 980, ENEMY);
    this.factions.set(PLAYER, { id: PLAYER, food: 280, baseUnitId: den.id });
    this.factions.set(ENEMY, { id: ENEMY, food: 180, baseUnitId: reef.id });

    this.spawnUnit('ant', 480, 815, PLAYER);
    this.spawnUnit('ant', 510, 910, PLAYER);
    this.spawnUnit('wolf', 585, 870, PLAYER);
    this.spawnUnit('eagle', 530, 770, PLAYER);
    this.initialPlayerArmySize = this.countPlayerArmy();
    this.spawnUnit('dolphin', 2020, 900, ENEMY);
    this.spawnUnit('dolphin', 2050, 1060, ENEMY);
    this.spawnUnit('crab', 1990, 990, ENEMY);

    this.spawnResource('berries', 650, 690, 650, 'ground');
    this.spawnResource('berries', 800, 1120, 760, 'ground');
    this.spawnResource('berries', 1150, 520, 600, 'ground');
    this.spawnResource('kelp', 2010, 770, 700, 'surface');
    this.spawnResource('kelp', 2320, 1240, 900, 'surface');
    this.spawnResource('kelp', 2780, 820, 650, 'deepsea');

    this.createProductionUi();
    this.wireInput();
    this.updateVision();
    this.updateHud();
    this.drawMinimap();
    this.log('まず Ant Swarm を選択し、近くの ✹ Berries を右クリックして Food を集めてください。');
  }

  update(_: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.handleCamera(dt);
    if (this.gameOver) {
      this.drawMinimap();
      return;
    }
    this.updateUnits(dt);
    this.updateFog();
    this.updateVisibility();
    this.drawMinimap();

    this.aiTimer += dt;
    this.waveTimer += dt;
    this.logTimer += dt;
    if (this.aiTimer > ENEMY_AI_INTERVAL) {
      this.aiTimer = 0;
      this.runAi();
      this.updateHud();
    }
  }

  private buildTerrain(): void {
    for (let y = 0; y < MAP_H; y += 1) {
      this.terrain[y] = [];
      for (let x = 0; x < MAP_W; x += 1) {
        const coast = 27 + Math.sin(y * 0.42) * 3 + Math.sin(y * 0.13) * 2;
        let terrain: Terrain = x < coast ? 'grass' : 'water';
        if (Math.abs(x - coast) < 2) terrain = 'shore';
        if (x > 39 || (x > 33 && y > 18)) terrain = 'deepwater';
        if (terrain === 'grass' && ((x + y * 3) % 11 === 0 || (x > 11 && x < 18 && y > 6 && y < 13))) terrain = 'forest';
        if ((terrain === 'water' || terrain === 'deepwater') && (x + y) % 13 === 0) terrain = 'reef';
        this.terrain[y][x] = terrain;
      }
    }
  }

  private drawTerrain(): void {
    const colors: Record<Terrain, number> = {
      grass: 0x355b30,
      forest: 0x244726,
      shore: 0x7d8f5b,
      water: 0x286f83,
      deepwater: 0x123e62,
      reef: 0x4f9c8f
    };
    this.terrainGfx.clear();
    for (let y = 0; y < MAP_H; y += 1) {
      for (let x = 0; x < MAP_W; x += 1) {
        this.terrainGfx.fillStyle(colors[this.terrain[y][x]], 1);
        this.terrainGfx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  private spawnUnit(type: string, x: number, y: number, faction: FactionId): UnitEntity {
    const def = UNIT_DEFS[type];
    const tint = faction === PLAYER ? '#f5f2dc' : '#d8f2ff';
    const label = this.add.text(x, y, def.emoji, {
      color: tint,
      fontFamily: 'Inter, Arial',
      fontSize: def.role === 'base' ? '34px' : '23px',
      fontStyle: '700'
    }).setOrigin(0.5).setDepth(60);
    const ring = this.add.circle(x, y, def.role === 'base' ? 34 : 17, 0xffffff, 0).setStrokeStyle(2, faction === PLAYER ? 0xcfe98c : 0x88d9ff, 0.9).setDepth(58);
    const hpBar = this.add.rectangle(x, y - (def.role === 'base' ? 45 : 27), 34, 4, 0x7fe36d).setOrigin(0.5).setDepth(61);
    const carryLabel = this.add.text(x, y - (def.role === 'base' ? 62 : 40), '', {
      color: '#f2c66d',
      fontFamily: 'Inter, Arial',
      fontSize: '11px',
      fontStyle: '700',
      stroke: '#162016',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(62).setVisible(false);
    const unit: UnitEntity = {
      id: this.nextUnitId++,
      def,
      faction,
      x,
      y,
      hp: def.maxHp,
      radius: def.role === 'base' ? 34 : 17,
      selected: false,
      carrying: 0,
      attackTimer: 0,
      produceTimer: 0,
      productionQueue: [],
      underConstruction: false,
      buildProgress: 0,
      label,
      ring,
      hpBar,
      carryLabel
    };
    this.units.set(unit.id, unit);
    return unit;
  }

  private spawnResource(type: ResourceNode['type'], x: number, y: number, amount: number, layer: MoveLayer): void {
    const ring = this.add.circle(x, y, 25, 0xffffff, 0).setStrokeStyle(2, type === 'berries' ? 0xf2c66d : 0x9af0ca, 0.75).setDepth(44);
    const label = this.add.text(x, y, type === 'berries' ? '✹' : '✦', {
      color: type === 'berries' ? '#f2c66d' : '#9af0ca',
      fontSize: '24px',
      fontStyle: '700'
    }).setOrigin(0.5).setDepth(45);
    this.resources.set(this.nextResourceId, { id: this.nextResourceId, type, x, y, amount, layer, label, ring });
    this.nextResourceId += 1;
  }

  private wireInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.dragStart = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.dragStart || !pointer.leftButtonDown()) return;
      this.drawSelectionBox(this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonReleased()) {
        if (this.pendingBuildType) {
          this.pendingBuildType = undefined;
          this.log('建築をキャンセルしました。');
          this.selectionGfx.clear();
          return;
        }
        this.issueCommand(pointer.worldX, pointer.worldY);
        return;
      }
      if (!this.dragStart) return;
      if (this.pendingBuildType) {
        this.selectionGfx.clear();
        this.tryBuild(this.pendingBuildType, pointer.worldX, pointer.worldY);
        this.pendingBuildType = undefined;
        this.dragStart = undefined;
        return;
      }
      const dist = Phaser.Math.Distance.Between(this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY);
      this.selectionGfx.clear();
      if (dist > 10) {
        this.selectRect(this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY);
      } else {
        this.selectAt(pointer.worldX, pointer.worldY);
      }
      this.dragStart = undefined;
      this.updateHud();
    });
  }

  private drawSelectionBox(x1: number, y1: number, x2: number, y2: number): void {
    this.selectionGfx.clear();
    this.selectionGfx.lineStyle(2, 0xd9f59f, 0.9);
    this.selectionGfx.fillStyle(0xd9f59f, 0.08);
    this.selectionGfx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    this.selectionGfx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  }

  private selectAt(x: number, y: number): void {
    const hit = [...this.units.values()]
      .filter((u) => u.faction === PLAYER && Phaser.Math.Distance.Between(x, y, u.x, u.y) <= u.radius + 10)
      .sort((a, b) => a.radius - b.radius)[0];
    this.setSelection(hit ? [hit.id] : []);
  }

  private selectRect(x1: number, y1: number, x2: number, y2: number): void {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const ids = [...this.units.values()]
      .filter((u) => u.faction === PLAYER && u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY)
      .map((u) => u.id);
    this.setSelection(ids);
  }

  private setSelection(ids: number[]): void {
    for (const unit of this.units.values()) {
      unit.selected = ids.includes(unit.id);
      unit.ring.setVisible(unit.selected);
    }
    this.selectedIds = new Set(ids);
  }

  private issueCommand(x: number, y: number): void {
    const selected = [...this.selectedIds].map((id) => this.units.get(id)).filter((u): u is UnitEntity => Boolean(u));
    if (selected.length === 0) {
      this.log('ユニットを選択してから右クリックで命令してください。');
      return;
    }
    const enemy = this.findUnitAt(x, y, ENEMY);
    const resource = this.findResourceAt(x, y);
    const gatherers = resource ? selected.filter((unit) => unit.def.gatherRate && this.canOccupy(unit.def.moveLayer, resource.x, resource.y)) : [];
    if (enemy) {
      this.log(`${this.formatGroup(selected)}: ${enemy.def.name} を攻撃します。`);
      if (enemy.def.id === 'reefNest') this.hasIssuedReefAttack = true;
      this.showCommandPing(enemy.x, enemy.y, 0xf06a57);
    } else if (resource && gatherers.length > 0) {
      this.log(`${this.formatGroup(gatherers)}: ${this.formatResource(resource)} を採集します。満載になったら自動で拠点へ戻ります。`);
      this.showCommandPing(resource.x, resource.y, resource.type === 'berries' ? 0xf2c66d : 0x9af0ca);
    } else if (resource) {
      this.log(`${this.formatResource(resource)} は Ant Swarm などの採集ユニットで集められます。`);
      this.showCommandPing(resource.x, resource.y, 0xf06a57);
    } else {
      this.log(`${this.formatGroup(selected)}: 移動します。`);
      this.showCommandPing(x, y, 0xd9f59f);
    }
    selected.forEach((unit, index) => {
      unit.attackTargetId = enemy?.id;
      unit.resourceTargetId = !enemy && resource && unit.def.gatherRate && this.canOccupy(unit.def.moveLayer, resource.x, resource.y) ? resource.id : undefined;
      if (enemy) {
        unit.targetX = enemy.x;
        unit.targetY = enemy.y;
      } else if (resource && unit.def.gatherRate) {
        unit.targetX = resource.x;
        unit.targetY = resource.y;
      } else {
        const angle = (index / Math.max(1, selected.length)) * Math.PI * 2;
        const spread = selected.length > 1 ? 34 : 0;
        unit.targetX = x + Math.cos(angle) * spread;
        unit.targetY = y + Math.sin(angle) * spread;
      }
    });
    this.updateHud();
  }

  private findUnitAt(x: number, y: number, faction?: FactionId): UnitEntity | undefined {
    return [...this.units.values()].find((u) => (!faction || u.faction === faction) && Phaser.Math.Distance.Between(x, y, u.x, u.y) <= u.radius + 8);
  }

  private findResourceAt(x: number, y: number): ResourceNode | undefined {
    return [...this.resources.values()].find((r) => Phaser.Math.Distance.Between(x, y, r.x, r.y) <= 32);
  }

  private showCommandPing(x: number, y: number, color: number): void {
    const outer = this.add.circle(x, y, 11, 0xffffff, 0).setStrokeStyle(2, color, 0.95).setDepth(82);
    const dot = this.add.circle(x, y, 3, color, 0.95).setDepth(83);
    this.tweens.add({
      targets: outer,
      scale: 2.1,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => outer.destroy()
    });
    this.tweens.add({
      targets: dot,
      scale: 0.4,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => dot.destroy()
    });
  }

  private showDeliveredFood(unit: UnitEntity, amount: number): void {
    const label = this.add.text(unit.x, unit.y - 48, `+${amount}`, {
      color: '#f2c66d',
      fontFamily: 'Inter, Arial',
      fontSize: '14px',
      fontStyle: '700',
      stroke: '#162016',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(90);
    this.tweens.add({
      targets: label,
      y: label.y - 24,
      alpha: 0,
      duration: 760,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy()
    });
  }

  private updateUnits(dt: number): void {
    for (const unit of [...this.units.values()]) {
      unit.attackTimer = Math.max(0, unit.attackTimer - dt);
      this.acquireTarget(unit);
      this.resolveGathering(unit, dt);
      this.resolveCombat(unit);
      this.resolveConstruction(unit, dt);
      this.resolveProduction(unit, dt);
      this.moveUnit(unit, dt);
      this.syncUnitGraphics(unit);
    }
    this.cleanupDestroyed();
    this.updateAttackTargetRings();
  }

  private acquireTarget(unit: UnitEntity): void {
    if (unit.def.attackDamage <= 0 || unit.attackTargetId) return;
    const target = [...this.units.values()]
      .filter((other) => other.faction !== unit.faction)
      .sort((a, b) => Phaser.Math.Distance.Between(unit.x, unit.y, a.x, a.y) - Phaser.Math.Distance.Between(unit.x, unit.y, b.x, b.y))[0];
    if (target && Phaser.Math.Distance.Between(unit.x, unit.y, target.x, target.y) < unit.def.sight * 0.65) {
      unit.attackTargetId = target.id;
    }
  }

  private resolveGathering(unit: UnitEntity, dt: number): void {
    if (!unit.resourceTargetId || !unit.def.gatherRate) return;
    const resource = this.resources.get(unit.resourceTargetId);
    const base = this.findNearestBase(unit.faction, unit.x, unit.y);
    if (!resource || !base) {
      unit.resourceTargetId = undefined;
      return;
    }
    if (unit.carrying >= 45) {
      unit.targetX = base.x;
      unit.targetY = base.y;
      if (Phaser.Math.Distance.Between(unit.x, unit.y, base.x, base.y) < 62) {
        const delivered = Math.floor(unit.carrying);
        this.factions.get(unit.faction)!.food += delivered;
        unit.carrying = 0;
        if (unit.faction === PLAYER) {
          this.hasGatheredFood = true;
          this.showDeliveredFood(unit, delivered);
          this.log(`${unit.def.name} が Food ${delivered} を納品しました。`);
          this.updateHud();
        }
        unit.targetX = resource.x;
        unit.targetY = resource.y;
      }
      return;
    }
    if (Phaser.Math.Distance.Between(unit.x, unit.y, resource.x, resource.y) < 40) {
      const taken = Math.min(resource.amount, unit.def.gatherRate * dt);
      resource.amount -= taken;
      unit.carrying += taken;
      if (resource.amount <= 0) {
        resource.label.destroy();
        resource.ring.destroy();
        this.resources.delete(resource.id);
        unit.resourceTargetId = undefined;
      }
    }
  }

  private resolveCombat(unit: UnitEntity): void {
    if (!unit.attackTargetId || unit.def.attackDamage <= 0) return;
    const target = this.units.get(unit.attackTargetId);
    if (!target) {
      unit.attackTargetId = undefined;
      return;
    }
    const distance = Phaser.Math.Distance.Between(unit.x, unit.y, target.x, target.y);
    if (distance > unit.def.attackRange) {
      unit.targetX = target.x;
      unit.targetY = target.y;
      return;
    }
    unit.targetX = undefined;
    unit.targetY = undefined;
    if (unit.attackTimer <= 0) {
      const packBonus = unit.def.id === 'wolf' ? 1 + this.countNearbyAttackers(target.id, 'wolf') * 0.08 : 1;
      target.hp -= unit.def.attackDamage * packBonus;
      unit.attackTimer = unit.def.attackCooldown;
    }
  }

  private countNearbyAttackers(targetId: number, type: string): number {
    return [...this.units.values()].filter((u) => u.def.id === type && u.attackTargetId === targetId).length;
  }

  private moveUnit(unit: UnitEntity, dt: number): void {
    if (unit.def.speed <= 0 || unit.targetX === undefined || unit.targetY === undefined) return;
    const dx = unit.targetX - unit.x;
    const dy = unit.targetY - unit.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 6) {
      unit.targetX = undefined;
      unit.targetY = undefined;
      return;
    }
    const step = Math.min(distance, unit.def.speed * dt);
    const angle = Math.atan2(dy, dx);
    let nx = unit.x + Math.cos(angle) * step;
    let ny = unit.y + Math.sin(angle) * step;
    if (!this.canOccupy(unit.def.moveLayer, nx, ny)) {
      nx = unit.x + Math.cos(angle + 0.75) * step;
      ny = unit.y + Math.sin(angle + 0.75) * step;
      if (!this.canOccupy(unit.def.moveLayer, nx, ny)) {
        nx = unit.x + Math.cos(angle - 0.75) * step;
        ny = unit.y + Math.sin(angle - 0.75) * step;
      }
    }
    if (this.canOccupy(unit.def.moveLayer, nx, ny)) {
      unit.x = Phaser.Math.Clamp(nx, 20, WORLD_W - 20);
      unit.y = Phaser.Math.Clamp(ny, 20, WORLD_H - 20);
    }
  }

  private canOccupy(layer: MoveLayer, x: number, y: number): boolean {
    if (layer === 'air') return true;
    const terrain = this.terrainAt(x, y);
    if (layer === 'ground') return terrain === 'grass' || terrain === 'forest' || terrain === 'shore';
    if (layer === 'surface') return terrain === 'water' || terrain === 'shore' || terrain === 'reef';
    return terrain === 'deepwater' || terrain === 'reef' || terrain === 'water';
  }

  private terrainAt(x: number, y: number): Terrain {
    const tx = Phaser.Math.Clamp(Math.floor(x / TILE), 0, MAP_W - 1);
    const ty = Phaser.Math.Clamp(Math.floor(y / TILE), 0, MAP_H - 1);
    return this.terrain[ty][tx];
  }

  private syncUnitGraphics(unit: UnitEntity): void {
    unit.label.setPosition(unit.x, unit.y);
    unit.ring.setPosition(unit.x, unit.y);
    unit.hpBar.setPosition(unit.x, unit.y - (unit.def.role === 'base' ? 45 : 27));
    unit.carryLabel.setPosition(unit.x, unit.y - (unit.def.role === 'base' ? 62 : 42));
    if (unit.def.gatherRate && (unit.carrying > 0 || unit.resourceTargetId)) {
      unit.carryLabel.setText(`Food ${Math.floor(unit.carrying)}/45`);
      unit.carryLabel.setVisible(true);
    } else {
      unit.carryLabel.setVisible(false);
    }
    const ratio = unit.underConstruction ? unit.buildProgress / (unit.def.constructionTime ?? 1) : unit.hp / unit.def.maxHp;
    unit.hpBar.width = Math.max(4, 34 * Phaser.Math.Clamp(ratio, 0, 1));
    unit.hpBar.fillColor = unit.underConstruction ? 0xf0c15a : unit.hp / unit.def.maxHp < 0.35 ? 0xf06a57 : 0x7fe36d;
  }

  private resolveProduction(base: UnitEntity, dt: number): void {
    if (base.def.role !== 'base' || base.underConstruction || base.productionQueue.length === 0) return;
    const nextType = base.productionQueue[0];
    const nextDef = UNIT_DEFS[nextType];
    base.produceTimer += dt;
    if (base.produceTimer < nextDef.buildTime) return;
    base.produceTimer = 0;
    base.productionQueue.shift();
    const spawn = this.findSpawnPoint(base, nextDef.moveLayer);
    this.spawnUnit(nextType, spawn.x, spawn.y, base.faction);
    if (base.faction === PLAYER) {
      this.log(`${nextDef.name} の生産が完了しました。`);
      this.updateHud();
    }
  }

  private resolveConstruction(building: UnitEntity, dt: number): void {
    if (!building.underConstruction) return;
    const builder = building.builderId ? this.units.get(building.builderId) : undefined;
    if (!builder || builder.hp <= 0) return;
    const distance = Phaser.Math.Distance.Between(builder.x, builder.y, building.x, building.y);
    if (distance > building.radius + 28) {
      builder.targetX = building.x;
      builder.targetY = building.y;
      return;
    }
    builder.targetX = undefined;
    builder.targetY = undefined;
    building.buildProgress += dt;
    const constructionTime = building.def.constructionTime ?? 1;
    building.hp = Math.max(1, building.def.maxHp * Math.min(1, building.buildProgress / constructionTime));
    if (building.buildProgress >= constructionTime) {
      building.underConstruction = false;
      building.buildProgress = constructionTime;
      building.hp = building.def.maxHp;
      building.label.setAlpha(1);
      if (building.faction === PLAYER) {
        this.log(`${building.def.name} が完成しました。生産と納品が可能です。`);
        this.updateHud();
      }
    }
  }

  private cleanupDestroyed(): void {
    for (const unit of [...this.units.values()]) {
      if (unit.hp > 0) continue;
      if (unit.faction === PLAYER) this.selectedIds.delete(unit.id);
      this.attackTargetRings.get(unit.id)?.destroy();
      this.attackTargetRings.delete(unit.id);
      unit.label.destroy();
      unit.ring.destroy();
      unit.hpBar.destroy();
      unit.carryLabel.destroy();
      this.units.delete(unit.id);
      if (unit.def.role === 'base') {
        if (unit.underConstruction) {
          this.log(`${unit.def.name} の建築現場が破壊されました。`);
        } else if (unit.faction === ENEMY) {
          this.finishGame(true);
        } else if (!this.hasCompletedBase(PLAYER)) {
          this.finishGame(false);
        } else {
          this.log(`${unit.def.name} が破壊されました。`);
        }
      }
    }
  }

  private finishGame(victory: boolean): void {
    if (this.outcomeShown) return;
    this.gameOver = true;
    this.outcomeShown = true;
    for (const ring of this.attackTargetRings.values()) ring.destroy();
    this.attackTargetRings.clear();
    this.hud.outcomeTitle.textContent = victory ? 'Victory' : 'Defeat';
    this.hud.outcomeBody.textContent = victory
      ? 'Reef Nest を破壊しました。陸上勢力の勝利です。'
      : 'すべての拠点を失いました。海洋勢力に押し切られました。';
    this.hud.outcome.hidden = false;
    this.log(victory ? 'Reef Nest を破壊しました。勝利です。' : '拠点がすべて破壊されました。敗北です。');
    this.updateHud();
    this.drawMinimap();
  }

  private hasCompletedBase(faction: FactionId): boolean {
    return [...this.units.values()].some((unit) => unit.faction === faction && unit.def.role === 'base' && !unit.underConstruction);
  }

  private updateAttackTargetRings(): void {
    const targetIds = new Set<number>();
    for (const unit of this.units.values()) {
      if (unit.faction === PLAYER && unit.attackTargetId) targetIds.add(unit.attackTargetId);
    }

    for (const [targetId, ring] of [...this.attackTargetRings.entries()]) {
      if (!targetIds.has(targetId) || !this.units.has(targetId)) {
        ring.destroy();
        this.attackTargetRings.delete(targetId);
      }
    }

    for (const targetId of targetIds) {
      const target = this.units.get(targetId);
      if (!target) continue;
      let ring = this.attackTargetRings.get(targetId);
      if (!ring) {
        ring = this.add.circle(target.x, target.y, target.radius + 10, 0xffffff, 0).setStrokeStyle(3, 0xf06a57, 0.95).setDepth(64);
        this.attackTargetRings.set(targetId, ring);
      }
      const isVisible = target.faction === PLAYER || this.visible.has(`${Math.floor(target.x / TILE)},${Math.floor(target.y / TILE)}`);
      ring.setPosition(target.x, target.y);
      ring.setRadius(target.radius + 10 + Math.sin(this.time.now / 170) * 2);
      ring.setVisible(isVisible);
    }
  }

  private drawMinimap(): void {
    const ctx = this.minimapCtx;
    const width = this.hud.minimap.width;
    const height = this.hud.minimap.height;
    const tileW = width / MAP_W;
    const tileH = height / MAP_H;
    const terrainColors: Record<Terrain, string> = {
      grass: '#355b30',
      forest: '#244726',
      shore: '#7d8f5b',
      water: '#286f83',
      deepwater: '#123e62',
      reef: '#4f9c8f'
    };

    ctx.clearRect(0, 0, width, height);
    for (let y = 0; y < MAP_H; y += 1) {
      for (let x = 0; x < MAP_W; x += 1) {
        ctx.fillStyle = terrainColors[this.terrain[y][x]];
        ctx.fillRect(x * tileW, y * tileH, Math.ceil(tileW), Math.ceil(tileH));
        const key = `${x},${y}`;
        if (!this.explored.has(key)) {
          ctx.fillStyle = 'rgba(2, 4, 3, 0.74)';
          ctx.fillRect(x * tileW, y * tileH, Math.ceil(tileW), Math.ceil(tileH));
        } else if (!this.visible.has(key)) {
          ctx.fillStyle = 'rgba(2, 4, 3, 0.38)';
          ctx.fillRect(x * tileW, y * tileH, Math.ceil(tileW), Math.ceil(tileH));
        }
      }
    }

    for (const resource of this.resources.values()) {
      const key = `${Math.floor(resource.x / TILE)},${Math.floor(resource.y / TILE)}`;
      if (!this.explored.has(key)) continue;
      ctx.fillStyle = resource.type === 'berries' ? '#f2c66d' : '#9af0ca';
      ctx.fillRect((resource.x / WORLD_W) * width - 1.5, (resource.y / WORLD_H) * height - 1.5, 3, 3);
    }

    for (const unit of this.units.values()) {
      const key = `${Math.floor(unit.x / TILE)},${Math.floor(unit.y / TILE)}`;
      if (unit.faction !== PLAYER && !this.visible.has(key)) continue;
      const size = unit.def.role === 'base' ? 5 : 3;
      ctx.fillStyle = unit.faction === PLAYER ? '#d9f59f' : '#88d9ff';
      ctx.fillRect((unit.x / WORLD_W) * width - size / 2, (unit.y / WORLD_H) * height - size / 2, size, size);
      if (unit.selected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect((unit.x / WORLD_W) * width - size, (unit.y / WORLD_H) * height - size, size * 2, size * 2);
      }
    }

    const cam = this.cameras.main;
    ctx.strokeStyle = '#f2f7ee';
    ctx.lineWidth = 1;
    ctx.strokeRect((cam.scrollX / WORLD_W) * width, (cam.scrollY / WORLD_H) * height, (cam.width / WORLD_W) * width, (cam.height / WORLD_H) * height);
  }

  private centerCameraFromMinimap(event: MouseEvent): void {
    const rect = this.hud.minimap.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WORLD_W;
    const y = ((event.clientY - rect.top) / rect.height) * WORLD_H;
    const cam = this.cameras.main;
    cam.centerOn(x, y);
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, WORLD_W - cam.width);
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, WORLD_H - cam.height);
    this.drawMinimap();
  }

  private createProductionUi(): void {
    this.hud.production.innerHTML = '';
    for (const id of PLAYER_PRODUCTION) {
      const def = UNIT_DEFS[id];
      const button = document.createElement('button');
      button.dataset.unit = id;
      button.innerHTML = `<strong>${def.name}</strong><br>${def.cost} food · ${def.description}`;
      button.addEventListener('click', () => this.tryProduce(id, PLAYER));
      this.hud.production.appendChild(button);
    }
    const buildButton = document.createElement('button');
    buildButton.dataset.unit = 'fieldDen';
    buildButton.innerHTML = `<strong>Build Field Den</strong><br>${UNIT_DEFS.fieldDen.cost} food · 前線拠点を建築`;
    buildButton.addEventListener('click', () => this.beginBuild('fieldDen'));
    this.hud.production.appendChild(buildButton);
  }

  private tryProduce(type: string, faction: FactionId): boolean {
    const def = UNIT_DEFS[type];
    const state = this.factions.get(faction);
    const base = faction === PLAYER ? this.findSelectedBase() ?? this.findNearestBase(faction, this.cameras.main.worldView.centerX, this.cameras.main.worldView.centerY) : this.units.get(state?.baseUnitId ?? -1);
    if (!state || !base) {
      if (faction === PLAYER) this.log('生産できる拠点がありません。');
      return false;
    }
    if (base.underConstruction) {
      if (faction === PLAYER) this.log(`${base.def.name} は建築中です。完成すると生産できます。`);
      return false;
    }
    if (state.food < def.cost) {
      if (faction === PLAYER) this.log(`${def.name} には Food ${def.cost} が必要です。`);
      return false;
    }
    if (base.productionQueue.length >= 5) {
      if (faction === PLAYER) this.log('この拠点の生産キューは満杯です。');
      return false;
    }
    state.food -= def.cost;
    base.productionQueue.push(type);
    if (base.productionQueue.length === 1) base.produceTimer = 0;
    if (faction === PLAYER) this.log(`${def.name} を生産キューに追加しました。`);
    this.updateHud();
    return true;
  }

  private beginBuild(type: string): void {
    const state = this.factions.get(PLAYER);
    const workerSelected = [...this.selectedIds].some((id) => this.units.get(id)?.def.role === 'worker');
    if (!workerSelected) {
      this.log('Field Den は Ant Swarm を選択してから建築できます。');
      return;
    }
    if (!state || state.food < UNIT_DEFS[type].cost) {
      this.log('食料が足りません。');
      return;
    }
    this.pendingBuildType = type;
    this.log('建築地点を左クリックしてください。右クリックでキャンセル。');
  }

  private tryBuild(type: string, x: number, y: number): void {
    const state = this.factions.get(PLAYER);
    const def = UNIT_DEFS[type];
    const worker = [...this.selectedIds]
      .map((id) => this.units.get(id))
      .find((unit): unit is UnitEntity => unit !== undefined && unit.def.role === 'worker');
    if (!state || !worker || state.food < def.cost) return;
    if (!this.canOccupy(def.moveLayer, x, y) || this.terrainAt(x, y) === 'shore') {
      this.log('そこには建築できません。草地か森に建ててください。');
      return;
    }
    const blocked = [...this.units.values()].some((unit) => Phaser.Math.Distance.Between(unit.x, unit.y, x, y) < unit.radius + 46);
    if (blocked) {
      this.log('既存ユニットや建物に近すぎます。');
      return;
    }
    state.food -= def.cost;
    const building = this.spawnUnit(type, x, y, PLAYER);
    building.underConstruction = true;
    building.builderId = worker.id;
    building.hp = Math.max(1, def.maxHp * 0.12);
    building.label.setAlpha(0.55);
    building.productionQueue = [];
    worker.targetX = x;
    worker.targetY = y;
    this.setSelection([building.id]);
    this.log('建築現場を設置しました。Ant Swarm が近くで作業すると完成します。');
    this.updateHud();
  }

  private updateHud(): void {
    const player = this.factions.get(PLAYER);
    this.hud.resources.textContent = `Food ${Math.floor(player?.food ?? 0)}`;
    const selected = [...this.selectedIds].map((id) => this.units.get(id)).filter((u): u is UnitEntity => Boolean(u));
    if (selected.length === 0) {
      this.hud.selection.textContent = 'ユニットを選択してください';
    } else if (selected.length === 1) {
      const unit = selected[0];
      const queue = this.formatQueue(unit);
      const construction = this.formatConstruction(unit);
      const status = this.formatStatus(unit);
      this.hud.selection.textContent = `${unit.def.name} HP ${Math.ceil(unit.hp)}/${unit.def.maxHp}${construction}${queue}${status} · ${unit.def.description}`;
    } else {
      this.hud.selection.textContent = `${this.formatGroup(selected)} selected · 右クリックでまとめて移動/攻撃できます。`;
    }
    for (const button of [...this.hud.production.querySelectorAll('button')]) {
      const cost = UNIT_DEFS[button.dataset.unit ?? 'ant'].cost;
      const needsWorker = button.dataset.unit === 'fieldDen';
      const hasWorker = [...this.selectedIds].some((id) => this.units.get(id)?.def.role === 'worker');
      button.disabled = this.gameOver || (player?.food ?? 0) < cost || (needsWorker && !hasWorker);
    }
    this.updateMission();
  }

  private updateMission(): void {
    const reef = this.units.get(this.factions.get(ENEMY)?.baseUnitId ?? -1);
    const reefTile = reef ? `${Math.floor(reef.x / TILE)},${Math.floor(reef.y / TILE)}` : undefined;
    const victory = !reef;
    const completed: Record<string, boolean> = {
      gather: victory || this.hasGatheredFood,
      produce: victory || this.countPlayerArmy() > this.initialPlayerArmySize,
      scout: victory || this.explored.has(reefTile ?? '') || this.hasIssuedReefAttack,
      destroy: victory
    };
    const order = ['gather', 'produce', 'scout', 'destroy'];
    const current = order.find((step) => !completed[step]);
    for (const item of [...this.hud.mission.querySelectorAll<HTMLLIElement>('li[data-step]')]) {
      const step = item.dataset.step ?? '';
      item.classList.toggle('done', completed[step]);
      item.classList.toggle('current', step === current);
    }
  }

  private countPlayerArmy(): number {
    return [...this.units.values()].filter((unit) => unit.faction === PLAYER && unit.def.role !== 'base').length;
  }

  private formatGroup(units: UnitEntity[]): string {
    const counts = new Map<string, number>();
    for (const unit of units) counts.set(unit.def.name, (counts.get(unit.def.name) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => (count > 1 ? `${name} x${count}` : name)).join(', ');
  }

  private formatResource(resource: ResourceNode): string {
    return resource.type === 'berries' ? 'Berries' : 'Kelp';
  }

  private formatStatus(unit: UnitEntity): string {
    if (unit.attackTargetId) {
      const target = this.units.get(unit.attackTargetId);
      return target ? ` · Attacking ${target.def.name}` : '';
    }
    if (unit.resourceTargetId) {
      const resource = this.resources.get(unit.resourceTargetId);
      if (!resource) return '';
      const carrying = Math.floor(unit.carrying);
      return carrying >= 45
        ? ` · Returning Food ${carrying}/45`
        : ` · Gathering ${this.formatResource(resource)} ${carrying}/45`;
    }
    if (unit.targetX !== undefined && unit.targetY !== undefined) {
      return ' · Moving';
    }
    return unit.carrying > 0 ? ` · Carrying Food ${Math.floor(unit.carrying)}/45` : '';
  }

  private log(message: string): void {
    this.hud.log.textContent = message;
  }

  private runAi(): void {
    const ocean = this.factions.get(ENEMY);
    const reef = this.units.get(ocean?.baseUnitId ?? -1);
    if (this.gameOver) return;
    if (!ocean || !reef) return;
    if (ocean.food >= 100 && reef.productionQueue.length < 2) {
      const choice = AI_PRODUCTION[Phaser.Math.Between(0, AI_PRODUCTION.length - 1)];
      this.tryProduce(choice, ENEMY);
    }
    const waveDelay = this.wavesLaunched === 0 ? ENEMY_FIRST_WAVE_DELAY : ENEMY_WAVE_INTERVAL;
    for (const unit of this.units.values()) {
      if (unit.faction !== ENEMY || unit.def.role === 'base') continue;
      if (unit.def.gatherRate && !unit.resourceTargetId) {
        const resource = [...this.resources.values()].find((r) => r.type === 'kelp' && this.canOccupy(unit.def.moveLayer, r.x, r.y));
        if (resource) {
          unit.resourceTargetId = resource.id;
          unit.targetX = resource.x;
          unit.targetY = resource.y;
        }
      }
      if (this.waveTimer > waveDelay && unit.def.role !== 'worker') {
        const target = this.units.get(this.factions.get(PLAYER)?.baseUnitId ?? -1);
        if (target) {
          unit.attackTargetId = target.id;
          unit.targetX = target.x;
          unit.targetY = target.y;
        }
      }
    }
    if (this.waveTimer > waveDelay) {
      this.waveTimer = 0;
      this.wavesLaunched += 1;
      this.log('海洋勢力が群れで攻勢を開始しました。');
    }
  }

  private handleCamera(dt: number): void {
    const cam = this.cameras.main;
    const speed = 520 * dt;
    const keys = this.cameraKeys;
    if (keys?.A.isDown) cam.scrollX -= speed;
    if (keys?.D.isDown) cam.scrollX += speed;
    if (keys?.W.isDown) cam.scrollY -= speed;
    if (keys?.S.isDown) cam.scrollY += speed;
    const pointer = this.input.activePointer;
    const edge = 18;
    if (pointer.x < edge) cam.scrollX -= speed;
    if (pointer.x > cam.width - edge) cam.scrollX += speed;
    if (pointer.y < edge) cam.scrollY -= speed;
    if (pointer.y > cam.height - edge) cam.scrollY += speed;
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, WORLD_W - cam.width);
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, WORLD_H - cam.height);
  }

  private updateVision(): void {
    this.visible.clear();
    for (const unit of this.units.values()) {
      if (unit.faction !== PLAYER) continue;
      const minX = Math.floor((unit.x - unit.def.sight) / TILE);
      const maxX = Math.floor((unit.x + unit.def.sight) / TILE);
      const minY = Math.floor((unit.y - unit.def.sight) / TILE);
      const maxY = Math.floor((unit.y + unit.def.sight) / TILE);
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
          const cx = x * TILE + TILE / 2;
          const cy = y * TILE + TILE / 2;
          if (Phaser.Math.Distance.Between(unit.x, unit.y, cx, cy) <= unit.def.sight) {
            const key = `${x},${y}`;
            this.visible.add(key);
            this.explored.add(key);
          }
        }
      }
    }
  }

  private updateFog(): void {
    this.updateVision();
    this.fogGfx.clear();
    for (let y = 0; y < MAP_H; y += 1) {
      for (let x = 0; x < MAP_W; x += 1) {
        const key = `${x},${y}`;
        if (this.visible.has(key)) continue;
        this.fogGfx.fillStyle(0x020403, this.explored.has(key) ? 0.42 : 0.86);
        this.fogGfx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  private updateVisibility(): void {
    for (const unit of this.units.values()) {
      const isVisible = unit.faction === PLAYER || this.visible.has(`${Math.floor(unit.x / TILE)},${Math.floor(unit.y / TILE)}`);
      unit.label.setVisible(isVisible);
      unit.hpBar.setVisible(isVisible);
      unit.carryLabel.setVisible(isVisible && unit.def.gatherRate !== undefined && (unit.carrying > 0 || unit.resourceTargetId !== undefined));
      if (!unit.selected) unit.ring.setVisible(false);
    }
    for (const resource of this.resources.values()) {
      const key = `${Math.floor(resource.x / TILE)},${Math.floor(resource.y / TILE)}`;
      const isExplored = this.explored.has(key);
      resource.label.setVisible(isExplored);
      resource.ring.setVisible(isExplored);
    }
  }

  private findSelectedBase(): UnitEntity | undefined {
    return [...this.selectedIds].map((id) => this.units.get(id)).find((unit): unit is UnitEntity => unit !== undefined && unit.def.role === 'base' && !unit.underConstruction);
  }

  private findNearestBase(faction: FactionId, x: number, y: number): UnitEntity | undefined {
    return [...this.units.values()]
      .filter((unit) => unit.faction === faction && unit.def.role === 'base' && !unit.underConstruction)
      .sort((a, b) => Phaser.Math.Distance.Between(a.x, a.y, x, y) - Phaser.Math.Distance.Between(b.x, b.y, x, y))[0];
  }

  private formatQueue(unit: UnitEntity): string {
    if (unit.def.role !== 'base' || unit.underConstruction || unit.productionQueue.length === 0) return '';
    const current = UNIT_DEFS[unit.productionQueue[0]];
    const progress = Math.min(99, Math.floor((unit.produceTimer / current.buildTime) * 100));
    const names = unit.productionQueue.map((id) => UNIT_DEFS[id].name).join(', ');
    return ` · Queue ${names} (${progress}%)`;
  }

  private formatConstruction(unit: UnitEntity): string {
    if (!unit.underConstruction) return '';
    const progress = Math.min(99, Math.floor((unit.buildProgress / (unit.def.constructionTime ?? 1)) * 100));
    return ` · Building ${progress}%`;
  }

  private findSpawnPoint(base: UnitEntity, layer: MoveLayer): Phaser.Math.Vector2 {
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      const distance = base.radius + 42 + Math.floor(i / 8) * 28;
      const x = base.x + Math.cos(angle) * distance;
      const y = base.y + Math.sin(angle) * distance;
      const blocked = [...this.units.values()].some((unit) => Phaser.Math.Distance.Between(unit.x, unit.y, x, y) < unit.radius + 24);
      if (!blocked && this.canOccupy(layer, x, y)) {
        return new Phaser.Math.Vector2(x, y);
      }
    }
    return new Phaser.Math.Vector2(base.x, base.y + base.radius + 48);
  }
}
