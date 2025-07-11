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

  private callbacks: HUDViewCallbacks = {};

  constructor() {
    this.plantProducerBtn = document.getElementById('plant-producer-btn');
    this.plantTraffickerBtn = document.getElementById('plant-trafficker-btn');
    this.plantRetailerBtn = document.getElementById('plant-retailer-btn');
    this.hqCountEl = document.getElementById('hq-count');
    this.commoditiesCountEl = document.getElementById('commodities-count');
    this.moneyCountEl = document.getElementById('money-count');
    this.gameDateEl = document.getElementById('game-date');

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

  updateStats(hqCount: number, commodities: number, money: number, gameDate: Date) {
    if (this.hqCountEl) this.hqCountEl.textContent = hqCount.toString();
    if (this.commoditiesCountEl) this.commoditiesCountEl.textContent = commodities.toString();
    if (this.moneyCountEl) this.moneyCountEl.textContent = money.toFixed(2);
    // Keep showing the in-game calendar if you still want it
    if (this.gameDateEl) {
      this.gameDateEl.textContent = formatInTimeZone(
        gameDate,
        'UTC',                          // always show the “game” date in UTC
        'dd MMM yyyy HH:mm'
      );
    }
  }

  /* ----------------------------------------------------------------
     Real-world clock (called from main.ts every second)
     ---------------------------------------------------------------- */
  public updateLocalTime(now: Date, timeZone: string) {
    if (!this.gameDateEl) return;
    this.gameDateEl.textContent = formatInTimeZone(
      now,
      timeZone,
      'dd MMM yyyy HH:mm:ss'
    );
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
