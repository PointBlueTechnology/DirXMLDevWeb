// The model `Fishbone.model` produces (DirXMLDev edit/Fishbone.java), as the server returns it.
export type Channel = "publisher" | "subscriber" | "spine" | "driver";

export interface FishbonePolicy {
  id: string;
  ref: string;
  name: string;
  order: number;
  kind: string;
  /** Path relative to the tree root, if the link resolved. */
  file?: string;
  unresolved: boolean;
}

export interface FishboneBone {
  id: string;
  key: string;
  label: string;
  channel: Channel;
  setId: number;
  policies: FishbonePolicy[];
}

export interface FishboneFilter {
  id: string;
  file: string;
}

export interface FishboneModel {
  treeRoot: string;
  driverSet: { name: string; dn: string };
  driver: { name: string; dn: string; shimClass: string; dir: string };
  publisher: FishboneBone[];
  subscriber: FishboneBone[];
  spine: FishboneBone[];
  resources: FishboneBone[];
  filter?: FishboneFilter;
}
