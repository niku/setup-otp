import { group, info } from "@actions/core";
import { exec } from "@actions/exec";
import { GitHub } from "@actions/github";
import { readdirSync } from "fs";
import { cpus, platform } from "os";
import * as path from "path";
import { cwd, chdir } from "process";

export async function ensureRelease(octokit: GitHub, owner: string, repo: string, tagName: string): Promise<number> {
  try {
    const {
      data: { id }
      // eslint-disable-next-line @typescript-eslint/camelcase
    } = await octokit.repos.createRelease({ owner, repo, tag_name: tagName });
    return id;
  } catch (error) {
    info(error);
    const { data: releases } = await octokit.repos.listReleases({
      owner,
      repo
    });
    const release = releases.find(release => release.tag_name == tagName);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return release!.id;
  }
}

async function make(compileWorkingDirectoryPath: string): Promise<string> {
  const currentWorkingDiretcory = cwd();
  const releaseRootDirectoryPath = path.join(compileWorkingDirectoryPath, "release");
  const cpuCount = cpus().length;

  try {
    chdir(compileWorkingDirectoryPath);

    let sslOption: string;
    if (platform() === "darwin") {
      let opensslPath = "";
      await exec("brew", ["--prefix", "openssl"], {
        listeners: {
          stdout: (data: Buffer): void => {
            opensslPath += data.toString();
          }
        }
      });
      sslOption = `--with-ssl=${opensslPath.trim()}`;
    } else {
      sslOption = "--with-ssl";
    }

    await group("otp_build", async () => await exec("./otp_build", ["autoconf"]));
    await group("configure", async () => await exec("./configure", [sslOption, "--enable-dirty-schedulers"]));
    await group("make", async () => await exec("make", [`-j${cpuCount}`]));
    await group("make release", async () => await exec("make", ["release"]));
    return releaseRootDirectoryPath;
  } finally {
    chdir(currentWorkingDiretcory);
  }
}

async function archive(releaseRootDirectoryPath: string, otpVersion: string): Promise<string> {
  const currentWorkingDiretcory = cwd();

  try {
    chdir(releaseRootDirectoryPath);

    const subDirectories = readdirSync(".", { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    if (subDirectories.length < 1) {
      throw new Error(`Expect a sub directory in ${releaseRootDirectoryPath} exists, but it doesn't.`);
    } else if (1 < subDirectories.length) {
      throw new Error(
        `Expect a sub directory in ${releaseRootDirectoryPath} exists, but it has too many directories named ${subDirectories.join(
          ","
        )}.`
      );
    }
    const subDirectory = subDirectories[0];
    const archivedReleaseArtifactPath = path.join(
      releaseRootDirectoryPath,
      `precompiled-${otpVersion}-${subDirectory}.tar.gz`
    );

    // To compress files in the release directory easily, enter the directory
    chdir(subDirectory);
    await exec("tar", ["-zcf", archivedReleaseArtifactPath, "."]);
    return archivedReleaseArtifactPath;
  } finally {
    chdir(currentWorkingDiretcory);
  }
}

export async function makePrecompiledReleaseArtifact(
  compileWorkingDirectoryPath: string,
  otpVersion: string
): Promise<string> {
  const releaseRootDirectoryPath = await make(compileWorkingDirectoryPath);
  return await archive(releaseRootDirectoryPath, otpVersion);
}
