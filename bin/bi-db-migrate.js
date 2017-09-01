#!/usr/bin/env node

const yargs        = require('yargs');
const path         = require('path');
const fs           = require('fs');
const _            = require('lodash');
const Promise      = require('bluebird');
const childProcess = require('child_process');

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
/*
 * @param ROOT - project root with initialized git repository
 */
var ROOT = null;
var MIG_DIR = null;

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
    .option('dir', {
        alias: 'd',
        describe: 'Base directory path for migrations (relative to project root dir)',
        default: 'migrations',
        global: true,
        type: 'string'
    })
    .option('interactive', {
        alias: 'i',
        describe: 'if not enabled, it will NOT prompt the user for anything.',
        default: false,
        global: true,
        type: 'boolean'
    })
    .option('verbose', {
        alias: 'v',
        describe: 'Dumps more info to stdout',
        default: 1,
        count: true,
        global: true,
        type: 'boolean'
    })
    .version('version', 'Prints bi-service version', VERSION)
    .strict(true)
    .help('h', false)
    .alias('h', 'help')
    .wrap(yargs.terminalWidth());

    const argv = _yargs.argv;

}

/**
 * @param {Object} argv
 * @return {Promise}
 */
function _init(argv) {
    ROOT = utils.getNearestRepository();
    MIG_DIR = path.resolve(ROOT + path.sep + argv.dir);

    if (argv.v > 1) console.info('Project root: ' + ROOT);

    if (typeof ROOT !== 'string') {
        console.error('Failed to find git project root');
        process.exit(1);
    }

    return utils.hasMigrationsStructure(ROOT, argv.dir).then(function(has) {
        if (!has) {
            return utils.initFS(ROOT, argv.dir);
        }
    });
}

/**
 * @param {Object} argv
 * @return {Promise}
 */
function initSeedCmd(argv) {
    return _initSeedOrSchema(argv, 'seed');
}

/**
 * @param {Object} argv
 * @return {Promise}
 */
function initSchemaCmd(argv) {
    return _initSeedOrSchema(argv, 'schema');
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


/**
 * @param {Object} argv
 * @param {String} subject - seed|schema
 * @return {Promise}
 */
function _initSeedOrSchema(argv, subject) {
    return _init(argv).then(function() {
        let content = utils.generateSqlCommentFlags({
            require: argv.require
        });

        let fPath = 'src' + path.sep + argv.table + path.sep + subject + '.sql';

        try {
            utils.createFile(fPath, content, MIG_DIR);
            if (argv.v) {
                console.log(`Created ${subject} file at:`);
                console.log(MIG_DIR + path.sep + fPath);
            }
        } catch(e) {
            if (e.code == 'EEXIST') {
                console.error(`${subject} file already created at ${MIG_DIR + path.sep + fPath}`);
                console.error('Can not overwrite.');
                process.exit(1);
            }
            throw e;
        }

        if (argv.interactive) {
            return childProcess.spawn($EDITOR, [
                MIG_DIR + path.sep + fPath,
            ], {
                stdio: 'inherit'
            });
        }

    });
}
