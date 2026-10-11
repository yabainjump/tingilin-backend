export const CAMEROON_REGIONS = ['CENTRE', 'LITTORAL', 'OUEST', 'SUD_OUEST'] as const;

export type CameroonRegion = (typeof CAMEROON_REGIONS)[number];

export const REGION_LABELS: Record<CameroonRegion, string> = {
  CENTRE: 'Centre',
  LITTORAL: 'Littoral',
  OUEST: 'Ouest',
  SUD_OUEST: 'Sud-Ouest',
};

export const REGION_EXAMPLE_CITIES: Record<CameroonRegion, string> = {
  CENTRE: 'Yaoundé, Mbalmayo, Obala',
  LITTORAL: 'Douala, Ndogbong, Bonabéri',
  OUEST: 'Bafoussam, Bafang, Dschang',
  SUD_OUEST: 'Buéa, Limbé, Kumba',
};

export function isCameroonRegion(value: unknown): value is CameroonRegion {
  return (
    typeof value === 'string' &&
    (CAMEROON_REGIONS as readonly string[]).includes(value.toUpperCase())
  );
}

export function normalizeRegion(value: unknown): CameroonRegion | null {
  return isCameroonRegion(value) ? (value.toUpperCase() as CameroonRegion) : null;
}
