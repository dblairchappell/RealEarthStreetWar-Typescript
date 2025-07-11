import { DateTime } from "luxon";

/**
 * Formats a JS Date in the specified IANA time-zone.
 *   format string uses Luxon tokens, e.g. 'dd MMM yyyy HH:mm:ss'
 */
export function formatInTimeZone(
  date: Date,
  timeZone: string,
  format: string
): string {
  return DateTime.fromJSDate(date, { zone: timeZone }).toFormat(format);
}
