// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";

export default class GameController {
  private bankTimerId: number | null = null;
  private dateTimerId: number | null = null;
  private hqCount = 0;

  constructor(private state: GameState, private view: MapView) {
    // Timers are started explicitly from main.ts after map loads
  }

  /* ---------------- public API ---------------- */

  startLoops(): void {
    // economy tick every real-second
    this.bankTimerId = window.setInterval(() => this.tickEconomy(), 1000);

    // calendar tick every in-game day
    this.dateTimerId = window.setInterval(() => this.tickCalendar(), GameState.SECONDS_PER_DAY * 1000);
  }

  stopLoops(): void {
    if (this.bankTimerId !== null) clearInterval(this.bankTimerId);
    if (this.dateTimerId !== null) clearInterval(this.dateTimerId);
  }

  setHqCount(count: number) {
    this.hqCount = count;
  }

  updateHud() {
    this.view.updateHud({
      wageOffer: this.state.wageOffer,
      maxGangMembers: this.state.maxGangMembers,
      hqCount: this.hqCount,
      totalResidents: this.state.totalResidents,
      bankBalance: this.state.bankBalance,
      gameDate: this.state.gameDate,
      buildingCount: this.state.controlledBuildingIds.size
    });
  }

  /* ---------------- private helpers ---------------- */

  private tickEconomy() {
    const payingResidents = Math.max(0, this.state.totalResidents - this.hqCount);
    const incomePerSecond = (GameState.INCOME_PER_RESIDENT_PER_DAY / GameState.SECONDS_PER_DAY) * payingResidents;
    const wagesPerSecond = Math.max(0, this.hqCount - 1) * this.state.wageOffer; // first member (player) unpaid

    this.state.bankBalance += incomePerSecond - wagesPerSecond;
    this.updateHud();
  }

  private tickCalendar() {
    this.state.gameDate.setDate(this.state.gameDate.getDate() + 1);
    this.updateHud();
  }
}