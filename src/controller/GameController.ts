// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";

export default class GameController {
  constructor(private state: GameState, private view: MapView) {
  }

  updateView() {
    this.view.updateStats(
      this.state.hqs.length,
      this.state.commodities,
      this.state.money
    );
  }
}