import { info, group, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { mkdirP } from "@actions/io";
import { downloadTool, extractTar, cacheFile, find, findAllVersions } from "@actions/tool-cache";
import * as fs from "fs";
import * as path from "path";
import { cwd, chdir, env } from "process";
import { cpus, platform } from "os";

export class OTPVersionDidNotMatch extends Error {
  constructor(candidateVersions: string[], specifiedVersion: string) {
    const candidates = candidateVersions.map(candidateVersion => `"${candidateVersion}"`).join(",");
    const message = `Specified version "${specifiedVersion}" is not matched in ${candidates}.`;
    super(message);
  }
}

function parseOTPVersionsTable(otpVersionsTableText: string): string[] {
  return otpVersionsTableText
    .trim()
    .split("\n")
    .map(line => {
      const matched = line.match(/^OTP-([\.\d]+)/);
      if (matched === null) {
        return undefined;
      } else {
        return matched[1];
      }
    })
    .filter(x => x) as string[];
}

function ensureCompileWorkingDirectoryPath(extractedDirectoryPath: string, version: string): string {
  const compileRootDirectoryName = `otp-OTP-${version}`;
  const compileRootDirectoryPath = path.join(extractedDirectoryPath, compileRootDirectoryName);
  if (fs.existsSync(compileRootDirectoryPath)) {
    return compileRootDirectoryPath;
  } else {
    throw new Error(`Expect a directory ${compileRootDirectoryPath} exists, but it doesn't.`);
  }
}

async function makeArtifact(compileWorkingDirectoryPath: string, releaseFileName: string): Promise<string> {
  const currentWorkingDiretcory = cwd();
  const releaseFilePath = path.join(compileWorkingDirectoryPath, releaseFileName);
  try {
    chdir(compileWorkingDirectoryPath);

    await group("Configure", async () => {
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
    });

    await group("Make release", async () => {
      const cpuCount = cpus().length;
      await exec("make", [`-j${cpuCount}`]);
      await exec("make", ["release"]);
    });

    await group("Make release artifact as tar", async () => {
      let targetDirectoryName = "";
      await exec("ls", ["release"], {
        listeners: {
          stdout: (data: Buffer): void => {
            targetDirectoryName += data.toString();
          }
        }
      });
      // To compress files in the release directory easily, enter the directory
      chdir(path.join(compileWorkingDirectoryPath, "release", targetDirectoryName.trim()));
      return await exec("tar", ["-zcf", releaseFilePath, "."]);
    });
    return releaseFilePath;
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

export async function installOTP(versionSpec: string): Promise<void> {
  const cacheKeyName = "otp-release";
  const releaseFileName = "release.tar.gz";
  let cachedOTPReleasePath: string;
  cachedOTPReleasePath = find(cacheKeyName, versionSpec);
  info(
    cachedOTPReleasePath
      ? `The cache otp-release version ${versionSpec} is found at ${cachedOTPReleasePath}.`
      : `The cache otp-release version ${versionSpec} is not found.`
  );
  info(findAllVersions(cacheKeyName).join(","));
  if (!cachedOTPReleasePath) {
    const compileWorkingDirectoryPath = await group("Setup for compile", async () => {
      if (platform() === "darwin") {
        // wxWidgets is needed to compile wx module in erlang.
        exec("brew", ["install", "wxmac"]);
      }
      const otpVersionsTableTextFilePath = await downloadTool(
        "https://raw.githubusercontent.com/erlang/otp/master/otp_versions.table"
      );
      const otpVersionsTableText = await fs.promises.readFile(otpVersionsTableTextFilePath, "utf8");
      const otpVersions = parseOTPVersionsTable(otpVersionsTableText);
      const otpVersion = otpVersions.find(v => v === versionSpec);
      if (!otpVersion) {
        throw new OTPVersionDidNotMatch(otpVersions, versionSpec);
      }
      const downloadedFilePath = await downloadTool(`https://github.com/erlang/otp/archive/OTP-${otpVersion}.tar.gz`);
      const extractedDirectoryPath = await extractTar(downloadedFilePath);
      return ensureCompileWorkingDirectoryPath(extractedDirectoryPath, otpVersion);
    });
    const compiledArtifactPath = await makeArtifact(compileWorkingDirectoryPath, releaseFileName);
    cachedOTPReleasePath = await cacheFile(compiledArtifactPath, releaseFileName, cacheKeyName, versionSpec);
  }
  const installedPath = await install(path.join(cachedOTPReleasePath, releaseFileName));
  addPath(path.join(installedPath, "bin"));
  return;
}
