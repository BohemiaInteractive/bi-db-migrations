const path         = require('path');
const fs           = require('fs');
const _            = require('lodash');
const Promise      = require('bluebird');
const childProcess = require('child_process');
const semver       = require('semver');
const config       = require('bi-config');

const env     = process.env;
const VERSION = require('./package.json').version;
const $EDITOR = env.EDITOR;

const utils = require('./lib/util.js');

var _config = new config.Config;
_config.initialize();

/*
 * @param ROOT - project root with initialized git repository
 */
var ROOT = null;
var MIG_DIR = null;

module.exports = cliInterface;
module.exports.initSeedCmd        = initSeedCmd;
module.exports.initSchemaCmd      = initSchemaCmd;
module.exports.initMigrationCmd   = initMigrationCmd;
module.exports.seedCmd            = seedCmd;
module.exports.seedAllCmd         = seedAllCmd;
module.exports.migrateCmd         = migrateCmd;
module.exports.migrationStatusCmd = migrationStatusCmd;
module.exports.getConfig          = function() {
    return _config;
};


function cliInterface(yargs) {

    return yargs
    .usage('$0 <command> [options]')
    .command(['init:seed'], 'Creates a new seed file at $MIG_DIR/src/$TABLE/data.sql and opens it with $EDITOR', {
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
    .command(['init:schema'], 'Creates a new schema file at $MIG_DIR/src/$TABLE/schema.sql and opens it with $EDITOR', {
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
        dialect: {
            describe: 'SQL provider',
            choices: ['postgres', 'mysql'],
            default: _config.get('sequelize:dialect') || 'postgres',
            type: 'string'
        },
    }, initMigrationCmd)
    .command(['mig:status','migration:status'], 'List the status of migrations', {
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
    .option('mig-dir', {
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
    .strict(true);
}

/**
 * @param {Object} argv
 * @return {Promise}
 */
function _init(argv) {
    ROOT = utils.getNearestRepository();
    MIG_DIR = path.resolve(ROOT + path.sep + argv['mig-dir']);

    if (argv.v > 1) console.info('Project root: ' + ROOT);

    global.verbose = argv.v;

    if (typeof ROOT !== 'string') {
        console.error('Failed to find git project root');
        process.exit(1);
    }

    return utils.hasMigrationsStructure(ROOT, argv['mig-dir']).then(function(has) {
        if (!has) {
            return utils.initFS(ROOT, argv['mig-dir']);
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
function initMigrationCmd(argv) {
    let npmPackage, migVersion, latestRelease, tags;

    return _init(argv).then(function() {
        npmPackage = require(path.resolve(ROOT + '/package.json'));
        if (!semver.valid(npmPackage.version)) {
            throw new Error(`"${npmPackage.version}" is not valid semver version`);
        }
        return utils.getGitTagList(ROOT);
    }).then(function(tagList) {
        tags = tagList;
        migVersion = ~tags.indexOf(npmPackage.version) ? 'development' : npmPackage.version;
        latestRelease = utils.getPreviousRelease(npmPackage.version, tags);
        return utils.fetchMigrationTables(MIG_DIR);
    }).then(function(tables) {
        let _tables = _.reduce(tables, function(out, val, key) {
            if (val instanceof Array) {
                let table = _.clone(val[0]);
                table.table = key;
                out.push(table);
            }
            return out;
        }, []);

        return utils.populateMigrationDefinitions(_tables, tags[0], ROOT);
    }).then(function(tables) {
        tables.forEach(function(table) {
            let _seedRequires = utils.getRequiredTables(table.seedData);
            let _schemaRequires = utils.getRequiredTables(table.schemaData);

            table.requires = _.union(_seedRequires, _schemaRequires);
            table.seedDataDelta = utils.getNewLines(table.oldSeedData, table.seedData);
            table.schemaDataDelta = utils.getNewLines(table.oldSchemaData, table.schemaData);
        });
        tables = utils.filterAndSortTables(tables);

        if (!tables.length && global.verbose > 1) {
            console.info('No database changes detected. Creating empty migration file');
        }

        let promise;

        switch (argv.type) {
            case 'sql':
                promise =  utils.createPlainSqlMigration(tables, migVersion, MIG_DIR, argv.dialect);
                break;
            default:
                promise = Promise.resolve();
                break;
        }

        return promise.then(function(fPath) {
            return _openInEditorWhenInteractive(fPath, argv);
        });
    });
}

/**
 *
 */
function migrationStatusCmd() {
}

/**
 * @param {Object} argv
 */
function seedCmd(argv) {
}

/**
 *
 */
function seedAllCmd() {
}

/**
 * @param {Object} argv
 */
function migrateCmd() {
    const sequelize = require('./lib/sequelize.js');
    const Migrations = sequelize.modelManager.getModel('migrations');

    return utils.fetchMigrationState(Migrations).then(function(version) {
    });
}

/**
 * @param {String} fPath
 * @return {undefined}
 */
function _openInEditorWhenInteractive(fPath, argv) {
    if (argv.interactive && fPath) {
        return childProcess.spawn($EDITOR, [
            fPath,
        ], {
            stdio: 'inherit'
        });
    }
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

        return _openInEditorWhenInteractive(MIG_DIR + path.sep + fPath, argv);
    });
}
