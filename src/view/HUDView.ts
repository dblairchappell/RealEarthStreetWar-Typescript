// src/view/HUDView.ts

import { formatInTimeZone } from "../utils/time";
import { Updatable } from "../loop/GameLoop";
import tzLookup from "tz-lookup";

export default class HUDView implements Updatable {
  private gameDateEl: HTMLElement | null;

  // World clock elements
  private timeLondonEl: HTMLElement | null;
  private timeNyEl: HTMLElement | null;
  private timeTokyoEl: HTMLElement | null;

  private mapInstance: any = null; // Will be set by setMapInstance
  private gameState: any = null; // Will be set by setGameState

  constructor() {
    this.gameDateEl = document.getElementById('game-date');

    // Query world clock elements
    this.timeLondonEl = document.getElementById('time-london');
    this.timeNyEl = document.getElementById('time-ny');
    this.timeTokyoEl = document.getElementById('time-tokyo');
  }

  /**
   * Set map instance for timezone lookup
   */
  setMapInstance(map: any): void {
    this.mapInstance = map;
  }

  /**
   * Set game state reference for time updates
   */
  setGameState(state: any): void {
    this.gameState = state;
  }

  /**
   * Updatable implementation - updates time display every frame for smooth progression
   */
  public update(_deltaMs: number): void {
    if (!this.gameState || !this.mapInstance) return;

    // Get timezone for current map center
    const centre = this.mapInstance.getCenter();
    let zone: string;
    try {
      zone = tzLookup(centre.lat, centre.lng);
    } catch (_) {
      zone = 'UTC';
    }

    // Update time displays with current game time
    this.updateTimeDisplays(this.gameState.gameDate, zone);
  }

  /* ----------------------------------------------------------------
     Game clock display (now called every frame for smooth updates)
     ---------------------------------------------------------------- */
  public updateTimeDisplays(gameDate: Date, localTimeZone: string) {
    // Include seconds in format for smooth progression
    const format = 'dd MMM yyyy HH:mm:ss';

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
}
