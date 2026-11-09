export interface SunSettings {
  day: number;
  /** Minutes after midnight in Moscow (UTC+3). */
  minutes: number;
}

/** Approximate geometric solar position, without refraction.
 * NOAA: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * Fixed scene location: central Moscow, 55.7558 N / 37.6173 E, August, UTC+3.
 */
export function moscowAugustSun(day: number, minutes: number): { azimuth: number; elevation: number } {
  const rad = Math.PI/180, latitude = 55.7558*rad;
  const gamma = 2*Math.PI/365*(212+day-1+(minutes/60-12)/24);
  const equation = 229.18*(0.000075+0.001868*Math.cos(gamma)-0.032077*Math.sin(gamma)
    -0.014615*Math.cos(2*gamma)-0.040849*Math.sin(2*gamma));
  const declination = 0.006918-0.399912*Math.cos(gamma)+0.070257*Math.sin(gamma)
    -0.006758*Math.cos(2*gamma)+0.000907*Math.sin(2*gamma)-0.002697*Math.cos(3*gamma)+0.00148*Math.sin(3*gamma);
  const solarMinutes = ((minutes+equation+4*37.6173-180)%1440+1440)%1440;
  const hourAngle = (solarMinutes/4-180)*rad;
  const sinElevation = Math.sin(latitude)*Math.sin(declination)+Math.cos(latitude)*Math.cos(declination)*Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)))/rad;
  const azimuth = (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle)*Math.sin(latitude)
    -Math.tan(declination)*Math.cos(latitude))/rad+180+360)%360;
  return { azimuth, elevation };
}

export function solarPosition(sun: SunSettings): { azimuth: number; elevation: number } {
  return moscowAugustSun(sun.day, sun.minutes);
}

/** Dragging a compass direction chooses the nearest physically possible daylight time. */
export function solarMinuteForAzimuth(day: number, azimuth: number): number {
  let bestMinute = 0, bestDistance = Infinity;
  for (let minutes = 0; minutes < 1440; minutes++) {
    const position = moscowAugustSun(day, minutes);
    if (position.elevation < 0) continue;
    const distance = Math.abs(((position.azimuth-azimuth+540)%360)-180);
    if (distance < bestDistance) { bestDistance = distance; bestMinute = minutes; }
  }
  return bestMinute;
}
