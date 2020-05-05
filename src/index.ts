import { getInput, setFailed } from "@actions/core";
import { installOTP } from "./install-otp";

async function run(): Promise<void> {
  try {
    const otpVersion = getInput("otp-version");
    await installOTP(otpVersion);
  } catch (error) {
    setFailed(error.message);
  }
}

run();
