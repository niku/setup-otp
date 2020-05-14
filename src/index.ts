import { setFailed } from "@actions/core";
import { cwd, env } from "process";
import { makePrecompiledArtifact } from "./make-precompiled-artifact";

async function run(): Promise<void> {
  try {
    const currentWorkingDiretcory = cwd();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const otpVersion = env.GITHUB_REF!;
    await makePrecompiledArtifact(currentWorkingDiretcory, otpVersion);
  } catch (error) {
    setFailed(error.message);
  }
}

run();
