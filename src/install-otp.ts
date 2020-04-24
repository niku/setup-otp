import { debug } from "@actions/core";
import { exec } from "@actions/exec";
import { downloadTool, extractTar } from "@actions/tool-cache";
import * as fs from "fs";

export class VersionDidNotMatch extends Error {
  constructor(candidateVersions: string[], specifiedVersion: string) {
    const candidates = candidateVersions.map(candidateVersion => `"${candidateVersion}"`).join(",");
    const message = `Specified version "${specifiedVersion}" is not matched in ${candidates}.`;
    super(message);
  }
}

async function downloadVersionsText(): Promise<string> {
  return downloadTool("https://raw.githubusercontent.com/erlang/otp/master/otp_versions.table");
}

async function readText(path: string): Promise<string> {
  return fs.promises.readFile(path, "utf8");
}

function parseVersions(versionsText: string): string[] {
  return versionsText
    .trim()
    .split("\n")
    .map(line => {
      const matched = line.match(/^OTP-([\.\d]+)/);
      if (matched == null) {
        return undefined;
      } else {
        return matched[1];
      }
    })
    .filter(x => x) as string[];
}

function getReleasedVersion(versions: string[], version: string): string | undefined {
  return versions.find(v => v === version);
}

async function downloadTarGz(version: string): Promise<string> {
  return downloadTool(`https://github.com/erlang/otp/archive/OTP-${version}.tar.gz`);
}

async function compile(extractedDirectory: string): Promise<void> {
  await exec("./otp_build", ["autoconf"], { cwd: extractedDirectory });
  await exec("./configure", ["--with-ssl", "--enable-dirty-schedulers"], { cwd: extractedDirectory });
  await exec("make", [], { cwd: extractedDirectory });
  await exec("make", ["release"], { cwd: extractedDirectory });
  await exec("ls", ["-l"], { cwd: extractedDirectory });
  return;
}

export async function installOTP(spec: string): Promise<void> {
  debug("Starting: downloadVersionsText()");
  const versionsTextPath = await downloadVersionsText();
  debug(`Starting: readText(${versionsTextPath})`);
  const versionsText = await readText(versionsTextPath);
  debug(`Starting: parseVersions(${versionsText})`);
  const versions = parseVersions(versionsText);
  debug(`Starting: getReleasedVersion(${versions},${spec})`);
  const version = getReleasedVersion(versions, spec);
  if (!version) {
    throw new VersionDidNotMatch(versions, spec);
  }
  debug(`Starting: downloadTarGz(${version})`);
  const tarGzPath = await downloadTarGz(version);
  debug(`Starting: extractTar(${tarGzPath})`);
  const extractedDirectory = await extractTar(tarGzPath);
  debug(`Starting: compile(${extractedDirectory})`);
  await compile(extractedDirectory);
  return;
}
