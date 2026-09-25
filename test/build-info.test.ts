import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBuildInfo } from "../src/worker/build-info";
import { getDashboardOverview } from "../src/worker/dashboard-repository";
import { buildInfoText } from "../web/src/build-info";

const version = {
  id: "9d680e4a-262b-470f-9068-ed5e14341bbc",
  tag: "not-a-git-commit",
  timestamp: "2026-09-22T10:00:00.000Z"
};
const source = {
  baseCommit: "a".repeat(40),
  builtAt: "2026-09-22T09:59:00.000Z",
  sourceHash: "b".repeat(64),
  workingTree: "dirty" as const
};

describe("nachvollziehbare Build-Kennung", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("meldet ohne Build-Injektion keinen erfundenen Quellstand", () => {
    const build = getBuildInfo({});
    expect(build).toEqual({ versionId: null, versionCreatedAt: null, source: null });
    expect(buildInfoText(build)).toContain("Quellstand nicht hinterlegt");
    expect(buildInfoText(undefined)).toContain("Worker-Version nicht verfügbar");
  });

  it("uebernimmt die Plattform-Version ohne ihren Tag zum Git-Commit umzudeuten", () => {
    const build = getBuildInfo({ VERSION_METADATA: version });
    expect(build).toEqual({
      versionId: version.id,
      versionCreatedAt: version.timestamp,
      source: null
    });
    expect(buildInfoText(build)).toContain(version.id);
    expect(buildInfoText(build)).not.toContain(version.tag);
  });

  it("liefert den eingebetteten dirty Build in der Dashboard-API und nennt nur einen Basiscommit", async () => {
    vi.stubGlobal("__MATOOL_BUILD_INFO__", source);
    const overview = await getDashboardOverview({ ...env, VERSION_METADATA: version }, 7);
    expect(overview.build).toEqual({
      versionId: version.id,
      versionCreatedAt: version.timestamp,
      source
    });
    const text = buildInfoText(getBuildInfo({ VERSION_METADATA: version }));
    expect(text).toContain("Lokale Änderungen enthalten");
    expect(text).toContain(`Basiscommit ${source.baseCommit}`);
    expect(text).toContain(source.sourceHash);
    expect(text).not.toContain(` · Commit ${source.baseCommit}`);
  });

  it("bezeichnet nur einen belegten sauberen Git-Stand als Commit", () => {
    vi.stubGlobal("__MATOOL_BUILD_INFO__", { ...source, workingTree: "clean" });
    expect(buildInfoText(getBuildInfo({}))).toContain(` · Commit ${source.baseCommit}`);
    vi.stubGlobal("__MATOOL_BUILD_INFO__", { ...source, baseCommit: null, workingTree: "unknown" });
    expect(buildInfoText(getBuildInfo({}))).toContain("Git-Zuordnung nicht belegt");
  });
});
