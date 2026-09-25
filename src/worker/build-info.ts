import type { Env } from "./env";

export interface SourceBuildInfo {
  baseCommit: string | null;
  builtAt: string;
  sourceHash: string;
  workingTree: "clean" | "dirty" | "unknown";
}

declare const __MATOOL_BUILD_INFO__: SourceBuildInfo | undefined;

/** Platform version and bundle source identity are separate evidence. */
export function getBuildInfo(env: Pick<Env, "VERSION_METADATA">) {
  const version = env.VERSION_METADATA;
  const source = typeof __MATOOL_BUILD_INFO__ === "undefined"
    ? null
    : __MATOOL_BUILD_INFO__;
  return {
    versionId: version?.id || null,
    versionCreatedAt: version?.timestamp || null,
    source: source ?? null
  };
}
