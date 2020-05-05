import { info, group, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { mkdirP } from "@actions/io";
import { downloadTool, extractTar, cacheFile } from "@actions/tool-cache";
import * as fs from "fs";
import * as path from "path";
import { cwd, chdir, env } from "process";
import { cpus, platform } from "os";
import { deflate } from "zlib";

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
    let sslOption;
    switch (platform()) {
      case "darwin":
        let opensslPath = "";
        await exec("brew", ["--prefix", "openssl"], {
          listeners: {
            stdout: (data: Buffer): void => {
              opensslPath += data.toString();
            }
          }
        });
        sslOption = `--with-ssl=${opensslPath.trim()}`;
        break;
      default:
        sslOption = "--with-ssl";
    }
    await exec("./otp_build", ["autoconf"]);
    await exec("./configure", [sslOption, "--enable-dirty-schedulers"]);

    //
    // Make release
    //
    const cpuCount = cpus().length;
    await exec("make", [`-j${cpuCount}`]);
    await exec("make", ["release"]);

    //
    // Make tar
    //
    const outputTarPath = path.join(compileRootDirectoryPath, "release.tar.gz");
    let targetDirectoryName = "";
    await exec("ls", ["release"], {
      listeners: {
        stdout: (data: Buffer): void => {
          targetDirectoryName += data.toString();
        }
      }
    });
    // To compress files in the directory easily, enter the directory
    chdir(path.join(compileRootDirectoryPath, "release", targetDirectoryName.trim()));
    await exec("tar", ["-zcf", outputTarPath, "."]);

    return outputTarPath;
  } finally {
    chdir(currentWorkingDiretcory);
  }
}

async function install(artifactPath: string): Promise<string> {
  const currentWorkingDiretcory = cwd();
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const homePath = env.HOME!;
    const targetPath = path.join(".local", "otp");
    const erlRootPath = path.join(homePath, targetPath);
    chdir(homePath);
    mkdirP(erlRootPath);
    await exec("tar", ["zxf", artifactPath, "-C", targetPath, "--strip-components=1"]);
    await exec(path.join(targetPath, "Install"), ["-minimal", erlRootPath]);
    return erlRootPath;
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
  const installedPath = await group("install", async () => {
    const artifactPath = path.join(cachedArtifactDirectoryPath, "release.tar.gz");
    info(`Parameter: ${artifactPath}`);
    return install(artifactPath);
  });
  addPath(path.join(installedPath, "bin"));
  return;
}
