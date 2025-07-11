// src/view/HUDView.ts

import { formatInTimeZone } from "../utils/time";

export interface HUDViewCallbacks {
  onPlantProducer?: () => void;
  onPlantTrafficker?: () => void;
  onPlantRetailer?: () => void;
}

export default class HUDView {
  private plantProducerBtn: HTMLElement | null;
  private plantTraffickerBtn: HTMLElement | null;
  private plantRetailerBtn: HTMLElement | null;
  private hqCountEl: HTMLElement | null;
  private commoditiesCountEl: HTMLElement | null;
  private moneyCountEl: HTMLElement | null;
  private gameDateEl: HTMLElement | null;

  // World clock elements
  private timeLondonEl: HTMLElement | null;
  private timeNyEl: HTMLElement | null;
  private timeTokyoEl: HTMLElement | null;

  private callbacks: HUDViewCallbacks = {};

  constructor() {
    this.plantProducerBtn = document.getElementById('plant-producer-btn');
    this.plantTraffickerBtn = document.getElementById('plant-trafficker-btn');
    this.plantRetailerBtn = document.getElementById('plant-retailer-btn');
    this.hqCountEl = document.getElementById('hq-count');
    this.commoditiesCountEl = document.getElementById('commodities-count');
    this.moneyCountEl = document.getElementById('money-count');
    this.gameDateEl = document.getElementById('game-date');

    // Query world clock elements
    this.timeLondonEl = document.getElementById('time-london');
    this.timeNyEl = document.getElementById('time-ny');
    this.timeTokyoEl = document.getElementById('time-tokyo');

    this.setupEventListeners();
  }

  public setCallbacks(callbacks: Partial<HUDViewCallbacks>) {
    this.callbacks = callbacks;
  }

  private setupEventListeners() {
    this.plantProducerBtn?.addEventListener('click', () => this.callbacks.onPlantProducer?.());
    this.plantTraffickerBtn?.addEventListener('click', () => this.callbacks.onPlantTrafficker?.());
    this.plantRetailerBtn?.addEventListener('click', () => this.callbacks.onPlantRetailer?.());
  }

  updateStats(hqCount: number, commodities: number, money: number) {
    if (this.hqCountEl) this.hqCountEl.textContent = hqCount.toString();
    if (this.commoditiesCountEl) this.commoditiesCountEl.textContent = commodities.toString();
    if (this.moneyCountEl) this.moneyCountEl.textContent = money.toFixed(2);
  }

  /* ----------------------------------------------------------------
     Game clock display (called from main.ts every second)
     ---------------------------------------------------------------- */
  public updateTimeDisplays(gameDate: Date, localTimeZone: string) {
    const format = 'dd MMM yyyy HH:mm';

    // Update local time
    if (this.gameDateEl) {
      this.gameDateEl.textContent = formatInTimeZone(
        gameDate,
        localTimeZone,
        format
      );
    }

    // Update world clocks
    if (this.timeLondonEl) {
      this.timeLondonEl.textContent = formatInTimeZone(
        gameDate,
        'Europe/London',
        format
      );
    }
    if (this.timeNyEl) {
      this.timeNyEl.textContent = formatInTimeZone(
        gameDate,
        'America/New_York',
        format
      );
    }
    if (this.timeTokyoEl) {
      this.timeTokyoEl.textContent = formatInTimeZone(
        gameDate,
        'Asia/Tokyo',
        format
      );
    }
  }

  exitPlantingMode() {
    this.plantProducerBtn?.classList.remove('active');
    this.plantTraffickerBtn?.classList.remove('active');
    this.plantRetailerBtn?.classList.remove('active');
  }

  setPlantingButtonActive(type: 'producer' | 'trafficker' | 'retailer' | null) {
    this.exitPlantingMode();
    if (type === 'producer') this.plantProducerBtn?.classList.add('active');
    if (type === 'trafficker') this.plantTraffickerBtn?.classList.add('active');
    if (type === 'retailer') this.plantRetailerBtn?.classList.add('active');
  }
}
