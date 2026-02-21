#!/usr/bin/env node
import { run } from "cmd-ts";
import { app } from "./app.js";

run(app, process.argv.slice(2));
