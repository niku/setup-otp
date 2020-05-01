import { info, group } from "@actions/core";
import { exec } from "@actions/exec";
import { downloadTool, extractTar } from "@actions/tool-cache";
import * as fs from "fs";
import { join } from "path";
import { cwd, chdir } from "process";

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

async function compile(extractedDirectory: string, version: string): Promise<string> {
  const currentWorkingDiretcory = cwd();
  try {
    const dirents = await fs.promises.readdir(extractedDirectory, { withFileTypes: true });
    const dir = dirents.find(dirent => dirent.isDirectory);
    if (!dir) {
      throw new Error(`A directory is not found in ${currentWorkingDiretcory}`);
    }
    const compileRootDirectory = join(extractedDirectory, dir.name);
    chdir(compileRootDirectory);
    await exec("./otp_build", ["autoconf"]);
    await exec("./configure", ["--with-ssl", "--enable-dirty-schedulers"]);
    await exec("make", []);
    await exec("make", ["release"]);

    const releaseArtifactFileName = `${version}.tar.gz`;
    // e.g. release/x86_64-unknown-linux-gnu
    const releaseArtifactDirectory = (await fs.promises.readdir("release", { withFileTypes: true })).find(
      dirent => dirent.isDirectory
    );
    if (!releaseArtifactDirectory) {
      throw new Error(`A directory is not found in ${releaseArtifactDirectory}`);
    }
    await exec("tar", ["-zcf", releaseArtifactFileName, "-C", releaseArtifactDirectory.name]);
    return join(compileRootDirectory, releaseArtifactFileName);
  } finally {
    chdir(currentWorkingDiretcory);
  }
}

export async function installOTP(spec: string): Promise<void> {
  const versionsTextPath = await group("downloadVersionsText", async () => {
    return await downloadVersionsText();
  });
  const versionsText = await group("readText", async () => {
    info(`Parameter: ${versionsTextPath}`);
    return await readText(versionsTextPath);
  });
  const versions = await group("parseVersions", async () => {
    info(`Paramter: ${versionsText}`);
    return parseVersions(versionsText);
  });
  const version = await group("getReleasedVersion", async () => {
    info(`Parameter: ${versions},${spec}`);
    return getReleasedVersion(versions, spec);
  });
  if (!version) {
    throw new VersionDidNotMatch(versions, spec);
  }
  const tarGzPath = await group("downloadTarGz", async () => {
    info(`Parameter: ${version}`);
    return await downloadTarGz(version);
  });
  const extractedDirectory = await group("extractTar", async () => {
    info(`Parameter: ${tarGzPath}`);
    return await extractTar(tarGzPath);
  });
  const compiledArtifactPath = await group("compile", async () => {
    info(`Parameter: ${extractedDirectory}`);
    return await compile(extractedDirectory, version);
  });
  await group("install", async () => {
    info(`Parameter: ${compiledArtifactPath}`);
  });
  return;
}
