/**
 * Date helpers keyed to Australian Eastern time (AEST/AEDT) so the daily grid
 * rolls over at 04:00 AEST local time, not at the UTC midnight boundary.
 */

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Returns today's date (YYYY-MM-DD) in Australia/Sydney, automatically
 * handling the AEST/AEDT daylight-saving switch.
 */
export function todaySydneyDate(): string {
  return formatter.format(new Date());
}