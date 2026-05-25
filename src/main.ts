import Phaser from 'phaser';
import { AnimalRTSScene } from './game/AnimalRTSScene';
import './styles.css';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0e1410',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: {
    pixelArt: false,
    antialias: true
  },
  scene: [AnimalRTSScene]
});
