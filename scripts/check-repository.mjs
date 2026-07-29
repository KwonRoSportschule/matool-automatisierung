import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const forbiddenTrackedFiles = [
  /\.har$/i,
  /(^|\/)\.dev\.vars(?:\.(?!example$)[^/]+)?$/i,
  /(^|\/)\.env(?:\.(?!example$)[^/]+)?$/i,
  /(^|\/)fixtures\/raw\//i,
  /(^|\/)artifacts\/private\//i
];

const forbiddenContent = [
  {
    name: "Zapier Webhook URL",
    pattern: /https:\/\/hooks\.zapier\.com\//i
  },
  {
    name: "Cloudflare API token",
    pattern: /\b(?:cf_api_token|cloudflare_api_token)\s*[:=]\s*["'][^"']+/i
  },
  {
    name: "Private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  }
];

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8"
  }
)
  .split("\0")
  .filter(Boolean);

const findings = [];

for (const file of repositoryFiles) {
  if (forbiddenTrackedFiles.some((pattern) => pattern.test(file))) {
    findings.push(`verbotene Datei versioniert: ${file}`);
    continue;
  }

  const content = readFileSync(file, "utf8");
  for (const rule of forbiddenContent) {
    if (rule.pattern.test(content)) {
      findings.push(`${rule.name} in ${file}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Repository-Prüfung fehlgeschlagen:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Repository-Prüfung bestanden (${repositoryFiles.length} Dateien).`
  );
}
