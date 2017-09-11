const path         = require('path');
const fs           = require('fs');
const _            = require('lodash');
const Promise      = require('bluebird');
const childProcess = require('child_process');
const semver       = require('semver');
const config       = require('bi-config');
const Table        = require('easy-table');

const env     = process.env;
const VERSION = require('./package.json').version;
const $EDITOR = env.EDITOR;

const utils          = require('./lib/util.js');
const MigrationError = require('./lib/error/migrationError.js');

const _config = new config.Config;
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
            default: 2,
            type: 'number'
        },
    }, migrationStatusCmd)
    .command(['migrate'], 'Run pending migrations', {}, migrateCmd)
    .command(['seed'], 'Run seeder for specified table', {
        table: {
            alias: 't',
            describe: 'table name',
            required: true,
            type: 'string'
        },
    }, seedCmd)
    .command(['seed:all'], 'Run every seeder', {}, seedAllCmd)
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
 * make sure we have a project we can interact with and that file system
 * structure for migrations is in place
 *
 * @param {Object} argv
 * @return {Promise}
 */
function _init(argv) {
    ROOT = utils.getNearestRepository();

    if (argv.v > 1) console.info('Project root: ' + ROOT);

    global.verbose = argv.v;

    if (typeof ROOT !== 'string') {
        console.error('Failed to find git project root');
        process.exit(1);
    }

    return _inspectDir(argv, ROOT).then(function(has) {
        if (!has) {
            return utils.initFS(ROOT, argv['mig-dir']);
        }
    })
}


/**
 * @param {Object} argv
 * @param {String} projectRoot
 *
 * @return {Promise}
 */
function _inspectDir(argv, projectRoot) {
    MIG_DIR = path.resolve(projectRoot + path.sep + argv['mig-dir']);

    if (!fs.existsSync(projectRoot + '/package.json')) {
        return Promise.reject(new Error(`${projectRoot} isn't valid npm module, package.json not found`));
    }
    return utils.hasMigrationsStructure(projectRoot, argv['mig-dir']);
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
        //fetch current git semver release tags
        return utils.getGitTagList(ROOT);
    }).then(function(tagList) {
        tags = tagList;
        migVersion = npmPackage.version;
        //if current package.json version already has an equivalent git tag,
        //add `development` prerelease flag to the generated migration
        if (~tags.indexOf(npmPackage.version)) {
            if (semver.prerelease(migVersion)) {
                migVersion += '.';
            } else {
                migVersion += '-';
            }
            migVersion += 'development';
        }
        latestRelease = utils.getPreviousRelease(npmPackage.version, tags);
        //fetches dirrectories from $MIG_DIR/src/*
        return utils.fetchMigrationTables(MIG_DIR);
    }).then(function(tables) {
        let _tables = _.reduce(tables, function(out, val, key) {
            //we are gonna work only with the most recent version of a table
            //schema -> directories in $MIG_DIR/src/ can be version like:
            //$TABLE_NAME_v1 $TABLE_NAME_v2 etc...
            if (val instanceof Array) {
                let table = _.clone(val[0]);
                table.table = key;
                out.push(table);
            }
            return out;
        }, []);

        //reads the actual schema.sql & seed.sql files and populates corresponding
        //$table in _tables collection
        return utils.populateMigrationDefinitions(_tables, latestRelease, ROOT);
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

        //wrap sql commands into a transaction and save on fs
        let promise = utils.createPlainSqlMigration(
            tables,
            migVersion,
            MIG_DIR,
            argv.dialect,
            argv.type
        );

        return promise.then(function(fPath) {
            return _openInEditorWhenInteractive(fPath, argv);
        });
    });
}

/**
 * @param {Object} argv
 */
function migrationStatusCmd(argv) {
    const sequelize = require('./lib/sequelize.js');
    const Migrations = sequelize.modelManager.getModel('migrations');

    return Migrations.findAll({
        order: [['id', 'DESC']],
        limit: argv.limit
    }).then(function(migrations) {
        let t = new Table;
        migrations.forEach(function(mig) {
            t.cell('version', mig.version);
            t.cell('status', mig.status);
            t.cell('created_at', mig.created_at);
            t.cell('note', mig.note);
            t.newRow();
        });
        console.info(t.toString());
        process.exit(0);
    }).catch(function(err) {
        console.error(err.message);
        process.exit(1);
    });
}

/**
 * @param {Object} argv
 */
function seedCmd(argv) {
    return seedAllCmd(argv);
}

/**
 * @param {Object} argv
 */
function seedAllCmd(argv) {
    const sequelize = require('./lib/sequelize.js');

    //make sure cwd is a npm module and contains a folder with migrations
    return _inspectDir(argv, process.cwd()).then(function(has) {
        if (!has) {
            console.error(`${process.cwd()} doesn't have valid "migrations" folder`);
            return process.exit(1);
        }
        return utils.fetchMigrationTables(MIG_DIR);
    }).then(function(tables) {
        let _tables = _.reduce(tables, function(out, val, key) {
            if (val instanceof Array
                && (argv.table === undefined || key === argv.table)
            ) {
                let table = _.clone(val[0]);
                table.table = key;
                out.push(table);
            }
            return out;
        }, []);

        return utils.populateMigrationDefinitionsFromFS(_tables, null, ROOT);
    }).then(function(tables) {
        tables.forEach(function(table) {
            let _seedRequires = utils.getRequiredTables(table.seedData);
            let _schemaRequires = utils.getRequiredTables(table.schemaData);

            table.requires = _.union(_seedRequires, _schemaRequires);
            table.seedDataDelta = table.seedData;
        });
        //leave only the tables whose data & schema have changed since
        //previous release & sort tables so that those tables which are dependent
        //on others come after them
        tables = utils.filterAndSortTables(tables);

        if (!tables.length) {
            if (global.verbose) {
                console.info('Nothing to seed.');
            }
            process.exit(0);
        }

        let sql = '';
        tables.forEach(function(table) {
            sql += table.seedData;
        });
        //sql = sqlUtils[].main('', sql, Date.now());
        sql = utils.renderTemplate(sequelize.options.dialect, {
            seed: sql,
            migName: 'seeder_' + Date.now()
        });

        if (argv.verbose) {
            console.info('Seeding...');
        }
        if (argv.verbose > 2) {
            console.info(sql);
        }

        return utils.migratePlainSql.call(sql, sequelize).then(function() {
            if (argv.verbose) {
                console.info('Successfully seeded.');
            }
            process.exit(0);
        });
    }).catch(function(err) {
        console.error(err.message);
        process.exit(1);
    });
}

/**
 * @param {Object} argv
 */
function migrateCmd(argv) {
    const sequelize = require('./lib/sequelize.js');
    const Migrations = sequelize.modelManager.getModel('migrations');

    return _inspectDir(argv, process.cwd()).then(function(has) {
        if (!has) {
            console.error(`${process.cwd()} doesn't have valid "migrations" folder`);
            return process.exit(1);
        }
        return utils.fetchMigrationState(Migrations);
    }).then(function(version) {
        let migrations = utils.fetchMigrationScripts(MIG_DIR, version);

        return Promise.each(migrations, function(mig) {
            let fn;

            switch (mig.type) {
                case 'sql':
                    let sql = fs.readFileSync(mig.path);
                    fn = utils.migratePlainSql.bind(sql.toString());
                    break;
                case 'js':
                    fn = require(mig.path);
                    break;
            }

            if (argv.verbose) {
                console.info(`Initializing ${mig.version} migration...`);
            }

            return utils.migrate(fn, mig.version, sequelize).then(function() {
                if (argv.verbose) {
                    console.info(`${mig.version} migrated successfully.`);
                }
            });
        });
    }).catch(function(err) {
        if (err.toJSON) {
            console.error(err.toJSON());
        } else {
            console.error(err);
        }
        process.exit(1);
    }).then(function() {
        if (argv.verbose) {
            console.info('All done.');
            process.exit(0);
        }
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
 * creates sql file named seed.sql or schema.sql at corresponding location
 * for the db table
 *
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
