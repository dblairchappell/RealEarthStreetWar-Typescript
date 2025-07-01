// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";

export default class GameController {
  private gameClockTimer: number | null = null;

  constructor(private state: GameState, private view: MapView) {
  }

  public startClock() {
    if (this.gameClockTimer) return; // Prevent multiple timers
    this.gameClockTimer = window.setInterval(() => {
      this.tickClock();
    }, GameState.GAME_TICK_MS);
  }

  private tickClock() {
    this.state.gameDate.setMinutes(this.state.gameDate.getMinutes() + GameState.MINUTES_PER_TICK);
    this.updateView();
  }

  updateView() {
    this.view.updateStats(
      this.state.hqs.length,
      this.state.commodities,
      this.state.money,
      this.state.gameDate
    );
  }
}