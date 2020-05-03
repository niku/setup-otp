import { getInput, debug, setFailed } from "@actions/core";
import { installOTP } from "./install-otp";

async function run(): Promise<void> {
  try {
    const otpVersion = getInput("otp-version");
    debug(`Starting: installOTP(${otpVersion})`);
    await installOTP(otpVersion);
  } catch (error) {
    setFailed(error.message);
  }
}

run();
