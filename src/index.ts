import { setFailed, info } from "@actions/core";
import { exec } from "@actions/exec";
import { cwd } from "process";
import { makePrecompiledArtifact } from "./make-precompiled-artifact";

async function getOTPVersion(): Promise<string> {
  let buffer = "";
  await exec("git", ["describe", "--abbrev=0", "--tags"], {
    listeners: {
      stdline: (data: string): string => (buffer += data)
    }
  });
  return buffer.trim();
}

async function getTarget(): Promise<string> {
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
    const otpVersion = await getOTPVersion();
    const target = await getTarget();
    info(target);
    // await makePrecompiledArtifact(currentWorkingDiretcory, otpVersion);
  } catch (error) {
    setFailed(error.message);
  }
}

run();
