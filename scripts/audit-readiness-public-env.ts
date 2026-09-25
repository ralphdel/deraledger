import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";

import { auditAdminReadinessBrowserEnvironmentVariable } from "../src/lib/compliance/admin-readiness-browser-environment-policy";

type AuditEnvironment = Readonly<Record<string, string | undefined>>;
type AuditIo = Readonly<{
  output(line: string): void;
  warning(line: string): void;
}>;

export function auditReadinessPublicEnvironment(environment: AuditEnvironment): readonly string[] {
  return Object.keys(environment)
    .filter((name) => name.startsWith("NEXT_PUBLIC_"))
    .sort()
    .map((name) => {
      const result = auditAdminReadinessBrowserEnvironmentVariable(name, environment[name]);
      return `${result.status}|${name}|${result.reason}`;
    });
}

export function runReadinessPublicEnvironmentAudit(
  args: readonly string[],
  processEnvironment: AuditEnvironment,
  io: AuditIo,
): number {
  if (args.length > 1) {
    io.output("BLOCKED|LOCAL_ENV_FILE|invalid_arguments");
    return 1;
  }

  let environment: Record<string, string | undefined> = { ...processEnvironment };
  const localFilePath = args[0];
  if (localFilePath) {
    if (!existsSync(localFilePath)) {
      io.warning("WARN|LOCAL_ENV_FILE|file_missing");
    } else {
      try {
        environment = { ...environment, ...parse(readFileSync(localFilePath)) };
      } catch {
        io.output("BLOCKED|LOCAL_ENV_FILE|file_unreadable");
        return 1;
      }
    }
  }

  const lines = auditReadinessPublicEnvironment(environment);
  for (const line of lines) io.output(line);
  return lines.some((line) => line.startsWith("BLOCKED|")) ? 1 : 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = runReadinessPublicEnvironmentAudit(process.argv.slice(2), process.env, {
    output: (line) => console.log(line),
    warning: (line) => console.warn(line),
  });
}
