import { info, group } from "@actions/core";
import { exec } from "@actions/exec";
import { mkdirP } from "@actions/io";
import { downloadTool, extractTar, cacheFile } from "@actions/tool-cache";
import * as fs from "fs";
import * as path from "path";
import { cwd, chdir, env } from "process";
import { cpus, tmpdir } from "os";

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

function ensureCompileRootDirectoryPath(extractedDirectoryPath: string, version: string): string {
  const compileRootDirectoryName = `otp-OTP-${version}`;
  const compileRootDirectoryPath = path.join(extractedDirectoryPath, compileRootDirectoryName);
  if (fs.existsSync(compileRootDirectoryPath)) {
    return compileRootDirectoryPath;
  } else {
    throw new Error(`Expect a directory ${compileRootDirectoryPath} exists, but it doesn't.`);
  }
}

async function compile(compileRootDirectoryPath: string): Promise<string> {
  const currentWorkingDiretcory = cwd();
  try {
    chdir(compileRootDirectoryPath);
    //
    // Configure
    //
    await exec("./otp_build", ["autoconf"]);
    await exec("./configure", ["--with-ssl", "--enable-dirty-schedulers"]);

    //
    // Make release
    //
    const cpuCount = cpus().length;
    await exec("make", [`-j${cpuCount}`]);
    await exec("make", ["release"]);

    //
    // Make tar
    //
    const target = "x86_64-unknown-linux-gnu";
    await exec("tar", ["-zcf", "release.tar.gz", `release/${target}/`]);

    return path.join(compileRootDirectoryPath, "release.tar.gz");
  } finally {
    chdir(currentWorkingDiretcory);
  }
}

async function install(artifactPath: string): Promise<string> {
  const currentWorkingDiretcory = cwd();
  try {
    chdir(tmpdir());
    const targetPath = path.join(".local", "otp");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const erlRoot = path.join(env.HOME!, targetPath);
    mkdirP(targetPath);
    mkdirP(erlRoot);
    await exec("tar", ["zxf", artifactPath, "-C", targetPath, "--strip-components=1"]);
    await exec("ls", ["-l", targetPath]);
    await exec(path.join(targetPath, "Install"), ["-minimal", erlRoot]);
    return erlRoot;
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
    info(`Parameter: ${extractedDirectoryPath}, version`);
    return ensureCompileRootDirectoryPath(extractedDirectoryPath, version);
  });
  const compiledArtifactPath = await group("compile", async () => {
    info(`Parameter: ${compileRootDirectoryPath}`);
    return await compile(compileRootDirectoryPath);
  });
  const cachedArtifactDirectoryPath = await group("cacheFile", async () => {
    info(`Parameter: ${compiledArtifactPath}, "release.tar.gz", "otp", ${version}`);
    return await cacheFile(compiledArtifactPath, "release.tar.gz", "otp", version);
  });
  await group("install", async () => {
    const artifactPath = path.join(cachedArtifactDirectoryPath, "release.tar.gz");
    info(`Parameter: ${artifactPath}`);
    install(artifactPath);
  });
  return;
}
