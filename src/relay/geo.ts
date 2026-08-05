/**
 * Coarse, privacy-preserving geolocation for the admin view.
 *
 * The relay derives only a two-letter COUNTRY code from the client IP, entirely
 * in memory, and stores nothing but that code. The IP address itself is never
 * written to disk, never logged, and never returned by any endpoint. Data is a
 * CC0 (public-domain) IP→country database read by the MIT `maxmind` reader.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import maxmind from "maxmind";

export interface GeoReader {
  get(ip: string): unknown;
}

/** Open the bundled country database, or null if it isn't present (feature no-ops). */
export async function openGeo(): Promise<GeoReader | null> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const f = [
    path.join(here, "../assets/geo/country.mmdb"),
    path.join(here, "../../assets/geo/country.mmdb"),
    path.join(process.cwd(), "assets/geo/country.mmdb"),
    path.join(process.cwd(), "dist/assets/geo/country.mmdb"),
  ].find((p) => fs.existsSync(p));
  if (!f) return null;
  try {
    return (await maxmind.open(f)) as unknown as GeoReader;
  } catch {
    return null;
  }
}

/** Two-letter country code for an IP, or null (unknown / private / no db). */
export function countryFromReader(reader: GeoReader | null, ip: string): string | null {
  if (!reader || !ip) return null;
  try {
    const g = reader.get(ip) as {
      country?: { iso_code?: string };
      country_code?: string;
      registered_country?: { iso_code?: string };
    } | null;
    const code = g?.country?.iso_code ?? g?.country_code ?? g?.registered_country?.iso_code ?? null;
    return typeof code === "string" && /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * Best client IP from proxy headers (Fly sets `Fly-Client-IP`). Used ONLY to
 * derive a country in memory — the result is discarded immediately, never stored.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>, remote?: string): string {
  const fly = headers["fly-client-ip"];
  if (typeof fly === "string" && fly) return fly;
  const xff = headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff[0]) return String(xff[0]).split(",")[0].trim();
  return remote ?? "";
}
