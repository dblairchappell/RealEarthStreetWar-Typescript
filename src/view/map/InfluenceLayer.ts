  // view/map/InfluenceLayer.ts
  export class InfluenceLayer {
    private readonly sourceId = 'influence-area';
    private readonly fillLayerId = 'influence-area-fill';

    constructor(private map: any) {
      /* add empty GeoJSON source */
      this.map.addSource(this.sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as any,
      });

      /* add semi-transparent fill layer */
      this.map.addLayer({
        id: this.fillLayerId,
        type: 'fill',
        source: this.sourceId,
        paint: {
          'fill-color': '#007bff',
          'fill-opacity': 0.2,
        },
      });
    }

    /** Replace the data shown in the layer.  Accepts a GeoJSON geometry
     *  (Polygon or MultiPolygon) or null to clear. */
    update(geometry: any): void {
      const data = geometry
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry, properties: {} }],
          }
        : { type: 'FeatureCollection', features: [] };

      (this.map.getSource(this.sourceId) as any).setData(data);
    }

    /** Remove layer + source when the view is destroyed */
    destroy(): void {
      if (this.map.getLayer(this.fillLayerId)) {
        this.map.removeLayer(this.fillLayerId);
      }
      if (this.map.getSource(this.sourceId)) {
        this.map.removeSource(this.sourceId);
      }
    }
  }
