  // view/map/FeatureQuery.ts
  export class FeatureQuery {
    private readonly buildingLayers: string[] = ["building-footprints"];
    private transportLayers: string[] = [];

    constructor(private map: any) {
      // Determine transport layers (roads, waterways, etc.) once the style is loaded
      const layers = this.map.getStyle().layers;
      this.transportLayers = layers
        .filter((layer: any) => {
          if (layer.type !== "line") return false;
          const id: string = layer.id || "";
          return (
            id.includes("road") ||
            id.includes("street") ||
            id.includes("highway") ||
            id.includes("transportation") ||
            id.includes("waterway")
          );
        })
        .map((layer: any) => layer.id);
    }

    /**
     * Hit-test the given screen point and return the first matching building or
     * transport feature, if any.
     */
    query(point: { x: number; y: number }): {
      building?: any;
      transport?: any;
    } {
      const buildingFeatures = this.map.queryRenderedFeatures(point, {
        layers: this.buildingLayers,
      });
      const transportFeatures = this.map.queryRenderedFeatures(point, {
        layers: this.transportLayers,
      });

      return {
        building: buildingFeatures.length ? buildingFeatures[0] : undefined,
        transport: transportFeatures.length ? transportFeatures[0] : undefined,
      };
    }
  }
  
