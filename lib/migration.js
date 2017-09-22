const config           = require('bi-config');
const Promise          = require('bluebird');
const path             = require('path');
const fs               = require('fs');
const _                = require('lodash');
const semver           = require('semver');
const Table            = require('easy-table');
const childProcess     = require('child_process');
const sequelizeBuilder = require('bi-service-sequelize');

const metaTableBuilder = require('./meta_table.js');
const utils            = require('./lib/util.js');

const env     = process.env;
const $EDITOR = env.EDITOR;

module.exports = Migration;
module.exports.Migration = Migration;

/**
 * @public
 * @param {Object} options
 * @param {String} options.config - path to config.json5 / config.json file
 * @constructor
 */
function Migration(options) {
    options = options || {};

    this.config = new config.Config;

    let cfgOpt = {};

    if (options.config) {
        cfgOpt.fileConfigPath = options.config;
    }
    this.config.initialize(cfgOpt);

    this.MIG_DIR = null;
    this.ROOT = null;
}


/**
 * @private
 * @return {Promise}
 */
Migration.prototype._getSequelize = function() {
    const sequelize = sequelizeBuilder(this.config.getOrFail('sequelize'));
    metaTableBuilder(sequelize, sequelize.Sequelize.DataTypes);
    return sequelize;
};


/**
 * make sure we have a project we can interact with and that file system
 * structure for migrations is in place
 *
 * @private
 * @param {Object} argv
 * @return {Promise}
 */
Migration.prototype._init = Promise.method(function(argv) {
    this.ROOT = utils.getNearestRepository();

    if (argv.v > 1) console.info('Project root: ' + this.ROOT);

    global.verbose = argv.v;

    if (typeof this.ROOT !== 'string') {
        return utils.exit('Failed to find git project root', 1);
    }

    return _inspectDir(argv, this.ROOT).bind(this).then(function(has) {
        if (!has) {
            return utils.initFS(this.ROOT, argv['mig-dir']);
        }
    });
});


/**
 * @private
 * @param {Object} argv
 * @param {String} projectRoot
 *
 * @return {Promise}
 */
Migration.prototype._inspectDir = function _inspectDir(argv, projectRoot) {
    this.MIG_DIR = path.resolve(projectRoot + path.sep + argv['mig-dir']);

    if (!fs.existsSync(projectRoot + '/package.json')) {
        return Promise.reject(new Error(`${projectRoot} isn't valid npm module, package.json not found`));
    }
    return utils.hasMigrationsStructure(projectRoot, argv['mig-dir']);
};


/**
 * @private
 * @param {String} fPath
 * @return {undefined}
 */
Migration.prototype._openInEditorWhenInteractive = function(fPath, argv) {
    if (argv.interactive && fPath) {
        return childProcess.spawn($EDITOR, [
            fPath,
        ], {
            stdio: 'inherit'
        });
    }
}


/**
 * creates sql file named data.sql or schema.sql at corresponding location
 * for the db table
 *
 * @public
 * @param {Object} argv
 * @param {String} subject - seed|schema
 * @return {Promise}
 */
Migration.prototype._initSeedOrSchema = function(argv, subject) {
    const MIG_DIR = this.MIG_DIR;

    return _init(argv).bind(this).then(function() {
        let content = utils.generateSqlCommentFlags({
            require: argv.require
        });

        let fName;

        switch (subject) {
            case 'schema':
                fName = 'schema';
                break;
            case 'seed':
                fName = 'data';
                break;
            default:
                throw new Error(`Invalid subject ${subject}`);
        }

        let fPath = 'src' + path.sep + argv.table + path.sep + fName + '.sql';

        try {
            utils.createFile(fPath, content, MIG_DIR);
            if (argv.v) {
                console.log(`Created ${subject} file at:`);
                console.log(MIG_DIR + path.sep + fPath);
            }
        } catch(e) {
            if (e.code == 'EEXIST') {
                return utils.exit(
                    `${subject} file already created at ${MIG_DIR + path.sep + fPath} \nCan not overwrite.`
                    , 1
                );
            }
            throw e;
        }

        return this._openInEditorWhenInteractive(MIG_DIR + path.sep + fPath, argv);
    });
};

/**
 * @public
 * @param {Object} argv
 * @return {Promise}
 */
Migration.prototype.initSeedCmd = function initSeedCmd(argv) {
    return this._initSeedOrSchema(argv, 'seed');
};


/**
 * @param {Object} argv
 * @return {Promise}
 */
Migration.prototype.initSchemaCmd = function initSchemaCmd(argv) {
    return this._initSeedOrSchema(argv, 'schema');
};


/**
 * @public
 * @return {Promise}
 */
Migration.prototype.initMigrationCmd = function initMigrationCmd(argv) {
    let npmPackage
    ,   migVersion
    ,   latestRelease
    ,   tags
    ,   MIG_DIR = this.MIG_DIR;


    return this._init(argv).bind(this).then(function() {
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
            //schema -> directories in $MIG_DIR/src/ can be versioned like:
            //$TABLE_NAME_v1 $TABLE_NAME_v2 etc...
            if (val instanceof Array) {
                let table = _.clone(val[0]);
                table.table = key;
                out.push(table);
            }
            return out;
        }, []);

        //reads the actual schema.sql & data.sql files and populates corresponding
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
        let promise = utils.createMigration(
            tables,
            migVersion,
            MIG_DIR,
            argv.dialect,
            argv.type
        );

        return promise.bind(this).then(function(fPath) {
            if (argv.verbose) {
                console.info(`Created ${fPath}`);
            }
            return this._openInEditorWhenInteractive(fPath, argv);
        });
    });
};

/**
 * @public
 * @param {Object} argv
 * @return {Promise}
 */
Migration.prototype.migrationStatusCmd = Promise.method(function(argv) {
    const sequelize = this._getSequelize();
    const Migrations = sequelize.modelManager.getModel('migrations');

    return Migrations.findAll({
        order: [['id', 'DESC']],
        limit: argv.limit
    }).bind(this).then(function(migrations) {
        let t = new Table;
        migrations.forEach(function(mig) {
            t.cell('version', mig.version);
            t.cell('status', mig.status);
            t.cell('created_at', mig.created_at);
            t.cell('note', mig.note);
            t.newRow();
        });
        return utils.exit(t.toString(), 0);
    }).catch(function(err) {
        return utils.exit(err, 1);
    });
});

/**
 * @param {Object} argv
 */
Migration.prototype.seedCmd = function seedCmd(argv) {
    return seedAllCmd(argv);
};


/**
 * @param {Object} argv
 */
Migration.prototype.seedCmd = Promise.method(function(argv) {
    const sequelize = this._getSequelize()
    ,     MIG_DIR = this.MIG_DIR
    ,     ROOT    = this.ROOT;

    //make sure cwd is a npm module and contains a folder with migrations
    return this._inspectDir(argv, process.cwd()).then(function(has) {
        if (!has) {
            return utils.exit(`${process.cwd()} doesn't have valid "migrations" folder`, 1);
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
            if (argv.verbose) {
                console.info('Nothing to seed.');
            }
            return utils.exit(null, 0);
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
            return utils.exit(null, 0);
        });
    }).catch(function(err) {
        return utils.exit(err, 1);
    });
});


/**
 * @param {Object} argv
 */
Migration.prototype.migrateCmd = Promise.method(function(argv) {
    const sequelize = this._getSequelize();
    const Migrations = sequelize.modelManager.getModel('migrations');
    const MIG_DIR = this.MIG_DIR;

    return this._inspectDir(argv, process.cwd()).then(function(has) {
        if (!has) {
            return utils.exit(`${process.cwd()} doesn't have valid "migrations" folder`, 1)
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
        return utils.exit(err, 1);
    }).then(function() {
        if (argv.verbose) {
            console.info('All done.');
        }
        return utils.exit(null, 0);
    });
});
