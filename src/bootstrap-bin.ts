#!/usr/bin/env node

import { runCli } from "./cli.js";

const forwardedArgs = process.argv.slice(2);
await runCli(["init", ...forwardedArgs]);
