import { getInput, debug, setFailed } from "@actions/core";
import { installOTP } from "./install-otp";

async function run(): Promise<void> {
  try {
    const otpVersion = getInput("otp-version");
    debug(`otp-version: ${otpVersion}`);
    await installOTP(otpVersion);
  } catch (error) {
    setFailed(error.message);
  }
}

debug("begin run()");
run();
debug("end run()");
