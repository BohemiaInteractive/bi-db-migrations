const Migration = require('./lib/migration.js');

var CLI = false;

module.exports           = cliInterface;
module.exports.Migration = Migration;

let mig = module.exports.migration = new Migration();

function cliInterface(yargs) {

    mig.CLI = true;

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
    }, mig.initSeedCmd)
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
    }, mig.initSchemaCmd)
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
    }, mig.initMigrationCmd)
    .command(['mig:status','migration:status'], 'List the status of migrations', {
        limit: {
            alias: 'l',
            describe: 'Lists last n status reports. 0 for all',
            default: 2,
            type: 'number'
        },
    }, mig.migrationStatusCmd)
    .command(['migrate'], 'Run pending migrations', {}, mig.migrateCmd)
    .command(['seed'], 'Run seeder for specified table', {
        table: {
            alias: 't',
            describe: 'table name',
            required: true,
            type: 'string'
        },
    }, mig.seedCmd)
    .command(['seed:all'], 'Run every seeder', {}, mig.seedCmd)
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
