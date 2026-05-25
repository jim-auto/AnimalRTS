import Phaser from 'phaser';
import { AnimalRTSScene } from './game/AnimalRTSScene';
import './styles.css';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0e1410',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER
  },
  render: {
    pixelArt: false,
    antialias: true
  },
  scene: [AnimalRTSScene]
});

if (import.meta.env.DEV) {
  (globalThis as typeof globalThis & { __animalRTSGame?: Phaser.Game }).__animalRTSGame = game;
}
