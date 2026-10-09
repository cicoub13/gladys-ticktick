// -----------------------------------------------------------------------------
// Local calendar arithmetic: "today", "overdue", the hour an all-day task
// fires its trigger, and the texts Gladys shows as they are (widget subtitles,
// scene variables and outputs: the core never reformats them).
//
// The time zone is the one of the Gladys instance: the supervisor injects it
// as the TZ env var, which Node applies to Intl by default. `timeZone` is only
// passed explicitly by the tests (and for the time zone TickTick stores on an
// all-day task, see snapshot.js). `partsOf` and `formatLocalTime` come from
// ../gladys-adguard-home/src/time.js.
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const partsOf = (date, timeZone) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
      timeZone,
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );

// 'GMT+02:00' -> 120, plain 'GMT' (UTC itself) -> 0.
const offsetMinutes = (date, timeZone) => {
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(partsOf(date, timeZone).timeZoneName);
  if (!match) {
    return 0;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
};

/**
 * "HH:MM" on a 24 h clock, identical in English and French.
 * @param {Date} date - The instant to format.
 * @param {string} [timeZone] - IANA time zone, defaults to the process one (TZ).
 * @returns {string} The local time.
 * @example
 * formatLocalTime(new Date('2026-09-26T15:20:00Z'), 'Europe/Paris'); // '17:20'
 */
export function formatLocalTime(date, timeZone) {
  const { hour, minute } = partsOf(date, timeZone);
  return `${hour}:${minute}`;
}

/**
 * The local calendar day of an instant, as 'YYYY-MM-DD'.
 * @param {Date} date - The instant.
 * @param {string} [timeZone] - IANA time zone, defaults to the process one (TZ).
 * @returns {string} The local day.
 * @example
 * localDay(new Date('2026-10-09T22:30:00Z'), 'Europe/Paris'); // '2026-10-10'
 */
export function localDay(date, timeZone) {
  const { year, month, day } = partsOf(date, timeZone);
  return `${year}-${month}-${day}`;
}

/**
 * Shift a 'YYYY-MM-DD' day by a number of calendar days.
 * @param {string} day - The day.
 * @param {number} days - How many days to add (negative to go back).
 * @returns {string} The shifted day.
 * @example
 * addDays('2026-10-31', 1); // '2026-11-01'
 */
export function addDays(day, days) {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, dayOfMonth) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The instant of a local wall-clock time on a given day, e.g. 09:00 on
 * 2026-10-09 in the Gladys time zone. Around a DST change the offset of the
 * target instant wins (an hour skipped by the clock lands one hour later).
 * @param {string} day - 'YYYY-MM-DD'.
 * @param {number} hour - 0-23.
 * @param {number} [minute] - 0-59.
 * @param {string} [timeZone] - IANA time zone, defaults to the process one (TZ).
 * @returns {Date} The instant.
 * @example
 * zonedDateTime('2026-10-09', 9, 0, 'Europe/Paris'); // 2026-10-09T07:00:00.000Z
 */
export function zonedDateTime(day, hour, minute = 0, timeZone = undefined) {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const wallClock = Date.UTC(year, month - 1, dayOfMonth, hour, minute);
  const firstGuess = wallClock - offsetMinutes(new Date(wallClock), timeZone) * 60 * 1000;
  return new Date(wallClock - offsetMinutes(new Date(firstGuess), timeZone) * 60 * 1000);
}
