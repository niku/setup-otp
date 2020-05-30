import { setFailed, getInput, info } from "@actions/core";
import { exec } from "@actions/exec";
import { GitHub } from "@actions/github";
import { cwd, env } from "process";
import {
  getRelease,
  createRelease,
  getAsset,
  uploadAsset,
  makeReleaseAsset
} from "./make-precompiled-release-artifact";

async function getOTPVersion(): Promise<string> {
  let buffer = "";
  await exec("git", ["describe", "--abbrev=0", "--tags"], {
    listeners: {
      stdline: (data: string): string => (buffer += data)
    }
  });
  return buffer.trim();
}

async function getAssetName(): Promise<string> {
  let buffer = "";
  await exec("uname", ["-s", "-r"], {
    listeners: {
      stdline: (data: string): string => (buffer += data)
    }
  });
  return buffer
    .trim()
    .toLowerCase()
    .replace(" ", "-")
    .concat(".tar.gz");
}

async function run(): Promise<void> {
  try {
    const secretToken = getInput("secret-token");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [owner, repo] = (env.GITHUB_REPOSITORY! as string).split("/");
    const otpVersion = await getOTPVersion();
    const assetName = await getAssetName();
    const octokit = new GitHub(secretToken);
    let release;
    let releaseId;
    let uploadUrl;
    release = await getRelease(octokit, owner, repo, otpVersion);
    if (release) {
      releaseId = release[0];
      uploadUrl = release[1];
      info(`The Release(${otpVersion}) exists, id: ${releaseId}.`);
    } else {
      info(`The Release(${otpVersion}) doesn't exist, so it will be created.`);
      release = await createRelease(octokit, owner, repo, otpVersion);
      releaseId = release[0];
      uploadUrl = release[1];
      info(`The Release(${otpVersion}) is created, id: ${releaseId}.`);
    }
    const assetId = await getAsset(octokit, owner, repo, releaseId, assetName);
    if (assetId) {
      info(`The Asset(${assetName}) exists, id: ${assetId}. Skip creating the new Asset.`);
    } else {
      info(`The Asset(${assetName}) doesn't exist, so it will be created.`);
      const archivedReleaseAssetPath = await makeReleaseAsset(cwd(), assetName);
      info(`The Asset(${assetName}) is created, path: ${archivedReleaseAssetPath}`);
      uploadAsset(octokit, uploadUrl, assetName, archivedReleaseAssetPath);
      info(`The Asset(${assetName}) is uploaded.`);
    }
  } catch (error) {
    setFailed(error.message);
  }
}

run();
