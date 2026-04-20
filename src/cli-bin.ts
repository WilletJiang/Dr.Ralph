#!/usr/bin/env node

import { runCli } from "./cli.js";

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === "--init-intake") {
  await runCli(["intake", ...forwardedArgs.slice(1)]);
} else {
  await runCli(forwardedArgs);
}
