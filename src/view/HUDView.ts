// src/view/HUDView.ts

export type HUDCallbacks = {
  onPlantProducer?: () => void;
  onPlantTrafficker?: () => void;
  onPlantRetailer?: () => void;
  onToggleMovementMode?: () => void;
};

export default class HUDView {
  private plantProducerBtn: HTMLElement | null;
  private plantTraffickerBtn: HTMLElement | null;
  private plantRetailerBtn: HTMLElement | null;
  private movementModeBtn: HTMLElement | null;
  private hqCountEl: HTMLElement | null;
  private commoditiesCountEl: HTMLElement | null;
  private moneyCountEl: HTMLElement | null;
  private gameDateEl: HTMLElement | null;

  private callbacks: HUDCallbacks = {};

  constructor() {
    this.plantProducerBtn = document.getElementById('plant-producer-btn');
    this.plantTraffickerBtn = document.getElementById('plant-trafficker-btn');
    this.plantRetailerBtn = document.getElementById('plant-retailer-btn');
    this.movementModeBtn = document.getElementById('movement-mode-btn');
    this.hqCountEl = document.getElementById('hq-count');
    this.commoditiesCountEl = document.getElementById('commodities-count');
    this.moneyCountEl = document.getElementById('money-count');
    this.gameDateEl = document.getElementById('game-date');

    this.setupEventListeners();
  }

  setCallbacks(callbacks: HUDCallbacks) {
    this.callbacks = callbacks;
  }

  private setupEventListeners() {
    this.plantProducerBtn?.addEventListener('click', () => this.callbacks.onPlantProducer?.());
    this.plantTraffickerBtn?.addEventListener('click', () => this.callbacks.onPlantTrafficker?.());
    this.plantRetailerBtn?.addEventListener('click', () => this.callbacks.onPlantRetailer?.());
    this.movementModeBtn?.addEventListener('click', () => this.callbacks.onToggleMovementMode?.());
  }

  updateStats(hqCount: number, commodities: number, money: number, gameDate: Date) {
    if (this.hqCountEl) this.hqCountEl.textContent = hqCount.toString();
    if (this.commoditiesCountEl) this.commoditiesCountEl.textContent = commodities.toString();
    if (this.moneyCountEl) this.moneyCountEl.textContent = money.toFixed(2);
    if (this.gameDateEl) {
      this.gameDateEl.textContent = gameDate.toLocaleString('en-US', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    }
  }

  updateMovementModeButton(isFreeRotation: boolean) {
    if (this.movementModeBtn) {
      if (isFreeRotation) {
        this.movementModeBtn.textContent = '360° Mode';
        this.movementModeBtn.classList.add('free-rotation');
      } else {
        this.movementModeBtn.textContent = '8-Direction Mode';
        this.movementModeBtn.classList.remove('free-rotation');
      }
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
