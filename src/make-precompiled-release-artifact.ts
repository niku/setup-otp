import { group, info } from "@actions/core";
import { exec } from "@actions/exec";
import { GitHub } from "@actions/github";
import { createReadStream, readdirSync, statSync } from "fs";
import { cpus, platform } from "os";
import * as path from "path";
import { cwd, chdir } from "process";

export async function getRelease(
  octokit: GitHub,
  owner: string,
  repo: string,
  tag: string
): Promise<[number, string] | undefined> {
  const { data: release } = await octokit.repos.getReleaseByTag({
    owner,
    repo,
    tag
  });
  if (release) {
    // eslint-disable-next-line @typescript-eslint/camelcase
    return [release.id, release.upload_url];
  } else {
    return;
  }
}

export async function createRelease(
  octokit: GitHub,
  owner: string,
  repo: string,
  tag: string
): Promise<[number, string]> {
  const {
    // eslint-disable-next-line @typescript-eslint/camelcase
    data: { id, upload_url }
    // eslint-disable-next-line @typescript-eslint/camelcase
  } = await octokit.repos.createRelease({ owner, repo, tag_name: tag });
  info(`The new Release(${tag}) is created. id: ${id}.`);
  // eslint-disable-next-line @typescript-eslint/camelcase
  return [id, upload_url];
}

export async function getAsset(
  octokit: GitHub,
  owner: string,
  repo: string,
  releaseId: number,
  assetName: string
): Promise<number | undefined> {
  const { data: assets } = await octokit.repos.listAssetsForRelease({
    owner,
    repo,
    // eslint-disable-next-line @typescript-eslint/camelcase
    release_id: releaseId
  });
  const result = assets.find(asset => asset.name === assetName);
  return result?.id;
}

export async function uploadAsset(octokit: GitHub, url: string, name: string, assetPath: string): Promise<void> {
  const headers = {
    "content-type": "application/octet-stream",
    "content-length": statSync(assetPath).size
  };
  const data = createReadStream(assetPath);
  await octokit.repos.uploadReleaseAsset({
    headers,
    url,
    data,
    name
  });
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

async function archive(releaseRootDirectoryPath: string, assetName: string): Promise<string> {
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
    const archivedReleaseAssetPath = path.join(releaseRootDirectoryPath, assetName);

    // To compress files in the release directory easily, enter the directory
    chdir(subDirectory);
    await exec("tar", ["-zcf", archivedReleaseAssetPath, "."]);
    return archivedReleaseAssetPath;
  } finally {
    chdir(currentWorkingDiretcory);
  }
}

export async function makeReleaseAsset(otpRootDirectoryPath: string, assetName: string): Promise<string> {
  const archivedReleaseAssetPath = await make(otpRootDirectoryPath);
  return await archive(archivedReleaseAssetPath, assetName);
}
