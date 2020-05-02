import { info, group } from "@actions/core";
import { exec } from "@actions/exec";
import { downloadTool, extractTar, cacheDir } from "@actions/tool-cache";
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

async function ensureCompileRootDirectoryPath(extractedDirectoryPath: string): Promise<string> {
  // ensure having a child directory and return it
  const dirents = await fs.promises.readdir(extractedDirectoryPath, { withFileTypes: true });
  const dirPaths = dirents.filter(dirent => dirent.isDirectory).map(dirent => dirent.name);
  if (dirPaths.length !== 1) {
    throw new Error(`Expect a child directory in ${extractedDirectoryPath}, But get ${dirPaths}`);
  }
  return join(extractedDirectoryPath, dirPaths[0]);
}

async function compile(compileRootDirectoryPath: string): Promise<string> {
  const currentWorkingDiretcory = cwd();
  try {
    chdir(compileRootDirectoryPath);
    await exec("./otp_build", ["autoconf"]);
    await exec("./configure", ["--with-ssl", "--enable-dirty-schedulers"]);
    await exec("make", []);
    await exec("make", ["release"]);
    return join(compileRootDirectoryPath, "release");
  } finally {
    chdir(currentWorkingDiretcory);
  }
}

async function ensureInstallRootDirectoryPath(compiledArtifactPath: string): Promise<string> {
  // ensure having a child directory and return it
  const dirents = await fs.promises.readdir(compiledArtifactPath, { withFileTypes: true });
  const dirPaths = dirents.filter(dirent => dirent.isDirectory).map(dirent => dirent.name);
  if (dirPaths.length !== 1) {
    throw new Error(`Expect a child directory in ${compiledArtifactPath}, But get ${dirPaths}`);
  }
  return join(compiledArtifactPath, dirPaths[0]);
}

async function install(installRootDirectoryPath: string): Promise<void> {
  const currentWorkingDiretcory = cwd();
  try {
    chdir(installRootDirectoryPath);
    await exec("./Install", []);
    return;
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
  const extractedDirectoryPath = await group("extractTar", async () => {
    info(`Parameter: ${tarGzPath}`);
    return await extractTar(tarGzPath);
  });
  const compileRootDirectoryPath = await group("ensureCompileRootDirectoryPath", async () => {
    info(`Parameter: ${extractedDirectoryPath}`);
    return await ensureCompileRootDirectoryPath(extractedDirectoryPath);
  });
  const compiledArtifactPath = await group("compile", async () => {
    info(`Parameter: ${compileRootDirectoryPath}`);
    return await compile(compileRootDirectoryPath);
  });
  const installRootDirectoryPath = await group("ensureInstallRootDirectoryPath", async () => {
    info(`Parameter: ${compiledArtifactPath}`);
    return await ensureInstallRootDirectoryPath(compiledArtifactPath);
  });
  await group("cacheDir", async () => {
    info(`Parameter: ${installRootDirectoryPath}, "otp", ${version}`);
    cacheDir(installRootDirectoryPath, "otp", version);
  });
  await group("install", async () => {
    info(`Parameter: ${installRootDirectoryPath}`);
    install(installRootDirectoryPath);
  });
  return;
}
