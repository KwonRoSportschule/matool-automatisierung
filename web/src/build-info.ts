import type { DashboardBuildInfo } from "./types";

function formatBuildTime(value: string): string {
  const time = new Date(value);
  return Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin"
      }).format(time)
    : "Zeitpunkt unbekannt";
}

export function buildInfoText(build: DashboardBuildInfo | undefined): string {
  const parts = [build?.versionId
    ? `Worker-Version ${build.versionId}`
    : "Worker-Version nicht verfügbar"];
  if (build?.versionCreatedAt) {
    parts.push(`erstellt ${formatBuildTime(build.versionCreatedAt)}`);
  }
  if (build?.source) {
    const { source } = build;
    parts.push(`Quellstand SHA-256 ${source.sourceHash}`);
    parts.push(`Build ${formatBuildTime(source.builtAt)}`);
    if (source.workingTree === "clean" && source.baseCommit) {
      parts.push(`Commit ${source.baseCommit}`);
    } else if (source.workingTree === "dirty") {
      parts.push("Lokale Änderungen enthalten");
      if (source.baseCommit) parts.push(`Basiscommit ${source.baseCommit}`);
    } else {
      parts.push("Git-Zuordnung nicht belegt");
    }
  } else {
    parts.push("Quellstand nicht hinterlegt");
  }
  return parts.join(" · ");
}
