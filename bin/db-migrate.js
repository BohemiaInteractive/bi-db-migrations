#!/usr/bin/env node

const yargs = require('yargs');
require('../index.js')(yargs)
    .help('h', false)
    .alias('h', 'help')
    .wrap(yargs.terminalWidth())
    .argv;
