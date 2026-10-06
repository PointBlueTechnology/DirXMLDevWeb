import type { DriverOutline } from "./types";

/** The User Application driver's shim class: the one driver with forms, PRDs and the role catalog, whatever it is named. */
export const USER_APPLICATION_SHIM = "com.novell.idm.driver.ComposerDriverShim";

export function isUserApplication(d: { shimClass?: string | null; forms?: unknown[]; prds?: unknown[] }): boolean {
  // the class decides; a tree read from a source that lost the class still shows what it holds
  return d.shimClass === USER_APPLICATION_SHIM || ((d.forms?.length ?? 0) + (d.prds?.length ?? 0) > 0 && !d.shimClass);
}

export function userApplicationDrivers(drivers: DriverOutline[]): DriverOutline[] {
  return drivers.filter(isUserApplication);
}
