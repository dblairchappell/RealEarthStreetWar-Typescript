declare module "tz-lookup" {
  /**
   * Return the IANA time-zone name for a given latitude/longitude pair.
   */
  export default function tzLookup(lat: number, lon: number): string;
}
