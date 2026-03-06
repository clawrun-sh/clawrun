/** Typed step identifiers emitted by instance lifecycle operations. */
export type InstanceStep =
  | "create-instance"
  | "upgrade-instance"
  | "pack-deps"
  | "install-deps"
  | "copy-server-app"
  | "clean-cache";
