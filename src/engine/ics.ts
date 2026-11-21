// A daily reminder as a calendar event: free, local, no push server.
const pad = (n: number) => String(n).padStart(2, '0')

export function buildDailyIcs(opts: { hour: number; minute: number; url: string; start?: Date; title?: string }): string {
  const s = opts.start ?? new Date()
  const date = `${s.getFullYear()}${pad(s.getMonth() + 1)}${pad(s.getDate())}`
  const t = `${pad(opts.hour)}${pad(opts.minute)}00`
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//polyglot//reminder//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:polyglot-daily-${date}${t}@local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${date}T${t}`, // floating local time
    'DURATION:PT15M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:${opts.title ?? 'Language practice (any length counts)'}`,
    `DESCRIPTION:Open the app and pick 5\\, 15\\, 30 or 60 minutes. ${opts.url}`,
    `URL:${opts.url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Language practice', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')
}
