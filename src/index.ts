import { setFailed, getInput } from "@actions/core";
import { exec } from "@actions/exec";
import { GitHub } from "@actions/github";
import { cwd, env } from "process";
import { ensureRelease, makePrecompiledReleaseArtifact } from "./make-precompiled-release-artifact";

async function getOTPVersion(): Promise<string> {
  let buffer = "";
  await exec("git", ["describe", "--abbrev=0", "--tags"], {
    listeners: {
      stdline: (data: string): string => (buffer += data)
    }
  });
  return buffer.trim();
}

async function getTargetTriple(): Promise<string> {
  let buffer = "";
  await exec("clang", ["-print-target-triple"], {
    listeners: {
      stdline: (data: string): string => (buffer += data)
    }
  });
  return buffer.trim();
}

async function run(): Promise<void> {
  try {
    const currentWorkingDiretcory = cwd();
    const secretToken = getInput("secret-token");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [owner, repo] = (env.GITHUB_REPOSITORY! as string).split("/");
    const otpVersion = await getOTPVersion();
    const targetTriple = await getTargetTriple();
    const isExists = await ensureRelease(new GitHub(secretToken), owner, repo, otpVersion);
    if (!isExists) {
      await makePrecompiledReleaseArtifact(currentWorkingDiretcory, otpVersion);
    }
  } catch (error) {
    setFailed(error.message);
  }
}

run();
