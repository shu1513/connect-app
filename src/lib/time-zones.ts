/** Every time zone name we accept, for example "America/New_York". */
export function timeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export function isTimeZone(value: string): boolean {
  return timeZones().includes(value);
}
