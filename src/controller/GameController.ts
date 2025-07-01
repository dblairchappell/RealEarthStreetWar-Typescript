// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";

export default class GameController {
  constructor(private state: GameState, private view: MapView) {
  }

  updateView() {
    // Simply update the HQ count display
    const hqCount = this.state.hqs.length;
    this.view.updateHQCount(hqCount);
  }
}