#!/usr/bin/env node

const yargs   = require('yargs');
const path    = require('path');
const fs      = require('fs');
const _       = require('lodash');
const Promise = require('bluebird');

const env     = process.env;
const VERSION = require('../package.json').version;
const $EDITOR = env.EDITOR;

const utils = require('../lib/util.js');

module.exports.initSeedCmd        = initSeedCmd;
module.exports.initSchemaCmd      = initSchemaCmd;
module.exports.initMigrationCmd   = initMigrationCmd;
module.exports.seedCmd            = seedCmd;
module.exports.seedAllCmd         = seedAllCmd;
module.exports.migrateCmd         = migrateCmd;
module.exports.migrationStatusCmd = migrationStatusCmd;

/*
 * @param _yargs - parser definition
 */
var _yargs = null;

//run only if this module isn't required by other node module
if (module.parent === null) {

    _yargs = yargs
    .usage('$0 <command> [options]')
    .command(['init:seed'], 'Creates a new seed file src/$TABLE/data.sql and opens it with $EDITOR', {
        table: {
            alias: 't',
            describe: 'table name',
            required: true,
            type: 'string'
        },
        require: {
            alias: 'r',
            describe: 'a table name which should be seeded before the table',
            array: true,
            type: 'string'
        },
    }, initSeedCmd)
    .command(['init:schema'], 'Creates a new sql schema file src/$TABLE/schema.sql and opens it with $EDITOR', {
        table: {
            alias: 't',
            describe: 'table name',
            required: true,
            type: 'string'
        },
        require: {
            alias: 'r',
            describe: 'a table name which should be migrated before the table',
            array: true,
            type: 'string'
        },
    }, initSchemaCmd)
    .command(['init:migration', 'init:mig'], 'Generates a new sql/js migration from the src/ table files', {
        type: {
            alias: 't',
            describe: 'Migration file type. Eihter plain sql file or js script file',
            choices: ['sql', 'js'],
            default: 'sql',
            type: 'string'
        },
    }, initMigrationCmd)
    .command(['status'], 'List the status of migrations', {
        limit: {
            alias: 'l',
            describe: 'Lists last n status reports. 0 for all',
            default: 0,
            type: 'number'
        },
    }, migrationStatusCmd)
    .command(['migrate'], 'Run pending migrations', {
    }, migrateCmd)
    .command(['seed'], 'Run specified seeder', {
        table: {
            alias: 't',
            describe: 'table name',
            required: true,
            type: 'string'
        },
    }, seedCmd)
    .command(['seed:all'], 'Run every seeder', {
    }, seedAllCmd)
    .option('interactive', {
        alias: 'i',
        describe: 'if not enabled, it will NOT prompt the user for anything.',
        default: true,
        type: 'boolean'
    })
    .option('verbose', {
        alias: 'v',
        describe: 'Dumps more info to stdout',
        default: 1,
        count: true,
        type: 'boolean'
    })
    .version('version', 'Prints bi-service version', VERSION)
    .help('h', false)
    .alias('h', 'help')
    .wrap(yargs.terminalWidth());

    const argv = _yargs.argv;
}

/**
 *
 */
function initSeedCmd() {
    console.log(utils.getNearestRepository());
}

/**
 *
 */
function initSchemaCmd() {
}

/**
 *
 */
function initMigrationCmd() {
}

/**
 *
 */
function migrationStatusCmd() {
}

/**
 *
 */
function seedCmd() {
}

/**
 *
 */
function seedAllCmd() {
}

/**
 *
 */
function migrateCmd() {
}


