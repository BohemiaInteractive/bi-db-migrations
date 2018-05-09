const _            = require('lodash');
const Promise      = require('bluebird');
const fs           = Promise.promisifyAll(require('fs'));
const path         = require('path');
const semver       = require('semver');
const childProcess = require('child_process');
const mustache     = require('mustache');

const MigrationError  = require('./error/migrationError.js');
const MigrationStatus = require('./migrationStatus.js');

module.exports.getNearestRepository                = getNearestRepository;
module.exports.assertFSDirs                        = assertFSDirs;
module.exports.fetchMigrationTables                = fetchMigrationTables;
module.exports.populateMigrationDefinitions        = populateMigrationDefinitions;
module.exports.populateMigrationDefinitionsFromGit = populateMigrationDefinitionsFromGit;
module.exports.populateMigrationDefinitionsFromFS  = populateMigrationDefinitionsFromFS;
module.exports.generateSqlCommentFlags             = generateSqlCommentFlags;
module.exports.initFS                              = initFS;
module.exports.createFile                          = createFile;
module.exports.gitGetFile                          = gitGetFile;
module.exports.getGitTagList                       = getGitTagList;
module.exports.filterAndSortTags                   = filterAndSortTags;
module.exports.getNewLines                         = getNewLines;
module.exports.getRequiredTables                   = getRequiredTables;
module.exports.filterAndSortTables                 = filterAndSortTables;
module.exports.sortTables                          = sortTables;
module.exports.createMigration                     = createMigration;
module.exports.getPreviousRelease                  = getPreviousRelease;
module.exports.migrate                             = migrate;
module.exports.fetchMigrationState                 = fetchMigrationState;
module.exports.fetchMigrationScripts               = fetchMigrationScripts;
module.exports.migratePlainSql                     = migratePlainSql;
module.exports.renderTemplate                      = renderTemplate;
module.exports.sortVersions                        = sortVersions;
module.exports.buildTableNotExistsErrorMatcher     = buildTableNotExistsErrorMatcher;

/**
 * mustache render function
 * @return {Function}
 */
function prettyPrint() {
    return function(text, render) {
        if (typeof text !== 'string') {
            return '';
        }
        text = render(text);

        return text.trim().split('\n').reduce(function(v, line, index) {
            if (line) {
                v += '        ' + line + '\n';
            } else {
                v += '\n';
            }
            return v;
        }, '');
    }
}

/**
 * @param {String} template - name as ./templates/{name}.mustache
 * @param {Object} context
 *
 * @return {String}
 */
function renderTemplate(template, context) {
    context = context || {};

    let tmpl = fs.readFileSync(
        path.resolve(__dirname + `/templates/${template}.mustache`)
    );

    context.prettyPrint = prettyPrint;
    return mustache.render(tmpl.toString(), context);
}

/**
 * retrieves version state of a db.
 * if no `migrations` meta table is found it will try to create it and then return empty (null) state
 *
 * @param {Sequelize.Model} model - sequelize representation of the `migrations` meta table
 * @return {Promise<string|null>}
 */
function fetchMigrationState(model) {
    return model.findAll({
        where: {
            status: {$in: [
                MigrationStatus.OK,
                MigrationStatus.PENDING
            ]}
        }
    }).then(function(migrations) {
        if (!migrations || !migrations.length) {
            return null;
        }

        return sortVersions(migrations.map(function(mig) {
            if (mig.status === MigrationStatus.PENDING) {
                let msg = `Awaiting penging migration: ${mig.version}. Try again later.`;
                throw new MigrationError(msg);
            }
            return mig.version;
        })).shift();
    }).catch(
        buildTableNotExistsErrorMatcher(model.sequelize.options.dialect),
        function(err) {
            return model.sync().then(function() {
                return null;
            });
        }
    );
}

/*
 * @param {String} dialect
 * @return {Function}
 */
function buildTableNotExistsErrorMatcher(dialect) {
    return function(err) {
        switch (dialect) {
            case 'postgres':
                return err.original && err.original.code === '42P01';
                break;
            case 'mysql':
                return err.original
                    && [err.original.errno + '', err.original.code].includes('1146');
                break;
            default:
                return false;
        }
    };
}

/**
 * @param {String} migDir
 * @param {String} lowerBoundary - semver version constrain - fetches only migrations for higher version than the lowerBoundary
 * @return {Array<Object>}
 */
function fetchMigrationScripts(migDir, lowerBoundary) {
    var out = [];

    _fileIterator([migDir], {
        except: [path.resolve(migDir + path.sep + 'src')]
    },function(filename, dir) {
        let file = path.parse(filename);

        if (   semver.valid(file.name)
            && ~['sql', 'js'].indexOf(file.ext.slice(1))
            && (!lowerBoundary
                || semver.gt(file.name, lowerBoundary))
        ) {
            out.push({
                path: path.resolve(dir +  path.sep + filename),
                type: file.ext.slice(1),
                version: file.name
            });
        }
    });

    //migrations with lower semver version comes first
    return out.sort(function(a, b) {
        if (semver.lt(a.version, b.version)) {//a is lower than b
            return -1;
        } else if (semver.eq(a.version, b.version)) {
            return 0;
        } else {
            return 1;
        }
    });
}

/**
 * executes migration
 *
 * @param {Function} mig
 * @param {String} version
 * @param {Sequelize} sequelize
 *
 * @return {Promise}
 */
function migrate(mig, version, sequelize) {
    const Migrations = sequelize.modelManager.getModel('migrations');

    if (typeof mig !== 'function') {
        return Promise.reject(new MigrationError(`Failed to initialize migration ${version}. Module does not export a function.`));
    }

    return Migrations.create({
        version: version,
        status: MigrationStatus.PENDING
    }).bind({}).catch(function(err) {
        let msg = `Failed to initialize ${version} migration. No changes have been made.`;
        throw new MigrationError(msg, err);
    }).then(function(migration) {
        this.migration = migration;
        let promise = mig.call(null, sequelize);

        if (   typeof promise !== 'object'
            && promise !== null
            && typeof promise.then !== 'function'
        ) {
            console.info('Warning: migration function did not return a Promise.');
            console.info('Neither migration status or its operations will be awaited');
        }

        return promise;
    }).catch(function(err) {
        return !(err instanceof MigrationError);
    }, function(err) {
        return Migrations.update({
            status: MigrationStatus.ERROR,
            note: err.message
        }, {
            where: {id: this.migration.id}
        }).then(function() {
            throw err;
        });
    }).then(function() {
        return Migrations.update({status: MigrationStatus.OK}, {
            where: {
                id: this.migration.id
            }
        }).catch(function(err) {
            let msg = `Failed to update the state of ${version} successfull migration.`;
            throw new MigrationError(msg, err);
        });
    });
}

/**
 * @param {Sequelize} sequelize
 * @this {String} migration sql string
 * @return {Promise}
 */
function migratePlainSql(sequelize) {
    //this = sql string
    return sequelize.query(this, {
        type: sequelize.QueryTypes.SELECT
    });
}

/**
 * Starts at the path of process.cwd and goes up
 * in directory hiearchy. The function resolves with first directory which
 * constains contains valid git reposiroty.
 *
 * @param {String} [dir] - starting point of repository lookup
 * @return {String}
 */
function getNearestRepository(dir) {
    let p = dir || process.cwd();

    while ((fs.statSync(p)).isDirectory()) {

        if (fs.existsSync(path.resolve(p + '/.git'))) {
            let gitStatus = childProcess.spawnSync('git', ['status'], {cwd: p});

            if (gitStatus.error) {
                throw gitStatus.error;
            }

            if (gitStatus.status === 0) {
                return p;
            }
        }

        let _p = path.resolve(p + '/../');
        if (_p == p)  break;
        p = _p;
    }

    return null;
}

/**
 * checks whether the project already has valid migrations file system directories
 * in place or it needs to be initialized
 *
 * @private
 * @param {String} projectRoot
 * @param {Array<String>} dirs - list of directories which should exist (relative to project's root)
 * @return {Promise<Boolean>}
 */
function assertFSDirs(projectRoot, dirs) {
    dirs = dirs || [];

    return Promise.reduce(dirs.map(function(dir) {
        return path.resolve(projectRoot + '/' + dir);
    }), function(out, p) {
        return fs.statAsync(p).then(function(stat) {
            out.push(stat.isDirectory());
            return out;
        }).catch(function(err) {
            if (err.code === 'ENOENT') {
                out.push(false);
                return out;
            }
            throw err;
        });
    }, []).then(function(paths) {
        let falsy = 0;
        let truthul = 0;

        paths.forEach(function(val) {
            if (val) {
                truthul++;
            } else {
                falsy++;
            }
        });

        if (falsy == paths.length) {
            return false;
        } else if (truthul == paths.length) {
            return true;
        } else {
            throw new Error(`Inconsistent fs structure`);
        }
    });
}

/**
 * creates initial file system structure for migrations
 *
 * @private
 * @param {String} projectRoot
 * @param {String} migDirName
 * @return {undefined}
 */
function initFS(projectRoot, migDirName) {
    let migPath = `${projectRoot}/${migDirName}`;
    let migSrcPath = `${projectRoot}/${migDirName}/src`;
    let migReadmePath = `${projectRoot}/${migDirName}/README.md`;

    if (!fs.existsSync(migPath)) {
        fs.mkdirSync(migPath)
    }

    if (!fs.existsSync(migSrcPath)) {
        fs.mkdirSync(migSrcPath);
    }

    fs.writeFileSync(migReadmePath, renderTemplate('README'));
}


/**
 * @example
 *
 * $migrations/src/country
 * $migrations/src/country_v1
 * $migrations/src/country_v2
 *
 * will result in sorted list of (in the specified order):
 *
 * {
 *   country: [
 *     {version: 'v2', path: 'path/to/dir'},
 *     {version: 'v1', path: 'path/to/dir'},
 *     {version: 'v0', path: 'path/to/dir'},
 *   ]
 * }
 *
 * @param {String} migDirPath
 * @return {Promise<Object>}
 */
function fetchMigrationTables(migDirPath) {
    return fs.readdirAsync(`${migDirPath}/src`).bind({
        files: {}
    }).map(function(fileName, index) {
        let segments = fileName.match(/(.+)(?:_)(v\d{1,2})$/)
        ,   key
        ,   value = {path: `${migDirPath}/src/${fileName}`};

        if (segments) {
            key = segments[1];
            value.version = segments[2];
        } else {
            key = fileName;
            value.version = 'v0';
        }

        if (!this.files.hasOwnProperty(key)) {
            this.files[key] = [value];
        } else {
            this.files[key].push(value);
        }
        return null;
    }).then(function() {
        var self = this;
        Object.keys(this.files).forEach(function(table) {
            self.files[table].sort(function(a, b) {
                let aVersion = parseInt(a.version.slice(1));
                let bVersion = parseInt(b.version.slice(1));

                return aVersion > bVersion ? -1 : 1;
            });
        });

        return this.files;
    });
}

/**
 * populates seedData & schemaData & oldSeedData & oldSchemaData properties
 * if correspoding fs files are available
 *
 * @param {Array<Object>} tableMigrations
 * @param {String} latestTag - the grater semver git tag
 * @param {String} projectRoot - git repository project root
 * @param {Integer} verbose
 * @return {Object}
 */
function populateMigrationDefinitions(tableMigrations, latestTag, projectRoot, verbose) {
    return Promise.all([
        populateMigrationDefinitionsFromFS(tableMigrations, latestTag, projectRoot, verbose),
        populateMigrationDefinitionsFromGit(tableMigrations, latestTag, projectRoot, verbose),
    ]).return(tableMigrations);
}

/**
 * @example
 *
 * //input is expected to be part of the output of fetchMigrationTables()
 * let input = [
 *   {path: 'migrations/src/country_v2', version: 'v2'},
 *   {path: 'migrations/src/app', version: 'v0'},
 * ];
 *
 * fetchTableMigrationDefinitions(input);
 *
 * assert(input).equal([
 *   {oldSeedData: 'string', oldSchemaData: 'string',  path: 'migrations/src/country_v2', version: 'v2'},
 *   {oldSeedData: 'string', oldSchemaData: 'string', path: 'migrations/src/app', version: 'v0'},
 * ]);
 *
 * populates oldSeedData & oldSchemaData properties if correspoding files are available
 *
 * @param {Array<Object>} tableMigrations
 * @param {String} latestTag - the grater semver git tag
 * @param {String} projectRoot - git repository project root
 * @param {Integer} verbose
 * @return {Object}
 */
function populateMigrationDefinitionsFromGit(tableMigrations, latestTag, projectRoot, verbose) {
    return Promise.map(tableMigrations, function(mig) {
        let seedPath = path.resolve(mig.path + path.sep + 'data.sql')
        ,   schemaPath = path.resolve(mig.path + path.sep + 'schema.sql')
        ,   gitSeedPath
        ,   gitSchemaPath;

        if (mig.path.indexOf(projectRoot) === 0) {
            gitSeedPath = seedPath.slice(projectRoot.length);
            gitSeedPath = _removeTrailingSlash(gitSeedPath);

            gitSchemaPath = schemaPath.slice(projectRoot.length);
            gitSchemaPath = _removeTrailingSlash(gitSchemaPath);
        }

        if (verbose >= 2) {
            console.log(`Reading git file ${latestTag}:${gitSeedPath}`);
            console.log(`Reading git file ${latestTag}:${gitSeedPath}`);
        }

        return Promise.props({
            oldSeed   : gitGetFile(gitSeedPath,latestTag,projectRoot).reflect(),
            oldSchema : gitGetFile(gitSchemaPath,latestTag,projectRoot).reflect(),
        });
    }).each(function(files, index) {
        if (files.oldSchema.isFulfilled()) {
            tableMigrations[index].oldSchemaData = files.oldSchema.value();
        } else if (   files.oldSchema.isRejected()
                   && files.oldSchema.reason().code !== 128 //path does not exists
        ) {
            throw files.oldSchema.reason();
        }

        if (files.oldSeed.isFulfilled()) {
            tableMigrations[index].oldSeedData = files.oldSeed.value();
        } else if (   files.oldSeed.isRejected()
                   && files.oldSeed.reason().code !== 128 //path does not exists
        ) {
            throw files.oldSeed.reason();
        }
    }).return(tableMigrations);
}

/**
 * @example
 *
 * //input is expected to be part of the output of fetchMigrationTables()
 * let input = [
 *   {path: 'migrations/src/country_v2', version: 'v2'},
 *   {path: 'migrations/src/app', version: 'v0'},
 * ];
 *
 * fetchTableMigrationDefinitions(input);
 *
 * assert(input).equal([
 *   {seedData: 'string', schemaData: 'string',  path: 'migrations/src/country_v2', version: 'v2'},
 *   {seedData: 'string', schemaData: 'string', path: 'migrations/src/app', version: 'v0'},
 * ]);
 *
 * populates seedData & schemaData properties if correspoding fs files are available
 *
 * @param {Array<Object>} tableMigrations
 * @param {String} latestTag - the grater semver git tag
 * @param {String} projectRoot - git repository project root
 * @param {Integer} verbose
 * @return {Object}
 */
function populateMigrationDefinitionsFromFS(tableMigrations, latestTag, projectRoot, verbose) {
    return Promise.map(tableMigrations, function(mig) {
        let seedPath = path.resolve(mig.path + path.sep + 'data.sql')
        ,   schemaPath = path.resolve(mig.path + path.sep + 'schema.sql');

        if (verbose >= 2) {
            console.log(`Reading file: ${seedPath}`);
            console.log(`Reading file: ${schemaPath}`);
        }

        return Promise.props({
            seed      : fs.readFileAsync(seedPath).reflect(),
            schema    : fs.readFileAsync(schemaPath).reflect()
        });
    }).each(function(files, index) {
        if (files.seed.isFulfilled()) {
            tableMigrations[index].seedData = files.seed.value().toString();
        } else if (files.seed.reason().code !== 'ENOENT') {
            throw files.seed.reason();
        }

        if (files.schema.isFulfilled()) {
            tableMigrations[index].schemaData = files.schema.value().toString();
        } else if (files.schema.reason().code !== 'ENOENT') {
            throw files.schema.reason();
        }
    }).return(tableMigrations);
}

/**
 * @param {Object} options
 * @param {Array} options.require - collection of required tables
 *
 * @return {String}
 */
function generateSqlCommentFlags(options) {
    let out = '';
    options = options || {};

    if (options.require instanceof Array) {
        options.require.forEach(function(prop) {
            out += `-- {require:${prop}}\n`
        });
    }

    return out;
}

/**
 * @param {String} filePath
 * @param {String} data
 * @return {}
 */
function createFile(filePath, data, _path) {
    _path = _path || '';
    let segments = filePath.split(path.sep);

    if (segments.length === 1) {
        _path = path.resolve(_path + path.sep + segments.shift());
        let fd = fs.openSync(_path, 'wx');
        fs.writeSync(fd, data);
        return fs.closeSync(fd);
    } else {
        var stat;
        _path = path.resolve(_path + path.sep + segments.shift());
        try {
            stat = fs.statSync(_path)
            if (!stat.isDirectory()) {
                throw new Error(`Expected ${_path} to be a directory`);
            }
        } catch(e) {
            fs.mkdirSync(_path);
        }
        return createFile(segments.join(path.sep), data, _path);
    }
}

/**
 * @param {String} fPath - absolute file path from the repository
 * @param {String} branch
 * @param {String} projectRoot - git project root
 * @return Promise<String>
 */
function gitGetFile(fPath, branch, projectRoot) {
    return new Promise(function(resolve, reject) {
        let args = [
            'show',
            `${branch}:${fPath}`
        ];

        var proc = childProcess.spawn('git', args, {cwd: projectRoot});

        var stderr = '';
        var stdout = '';

        proc.stdout.on('data', function(data) {
            stdout += data.toString();
        });
        proc.stderr.on('data', function(data) {
            stderr += data.toString();
        });

        proc.on('close', function(code) {
            if (code !== 0) {
                let error = new Error(stderr)
                error.code = code;
                return reject(error);
            }

            return resolve(stdout);
        });
    });
}

/**
 * @param {String} projectRoot - git project root
 *
 * @return {Promise<Array<String>>}
 */
function getGitTagList(projectRoot) {
    return new Promise(function(resolve, reject) {
        let args = [
            'tag',
            '--format',
            '%(refname:strip=2)'
        ];

        var proc = childProcess.spawn('git', args, {cwd: projectRoot});

        var stderr = '';
        var stdout = '';

        proc.stdout.on('data', function(data) {
            stdout += data.toString();
        });
        proc.stderr.on('data', function(data) {
            stderr += data.toString();
        });

        proc.on('close', function(code) {
            if (code !== 0) {
                let error = new Error(stderr)
                error.code = code;
                return reject(error);
            }

            return resolve(stdout.split('\n'));
        });
    });
}

/**
 * @param {String} version - a semver version the previous release will be resolved against
 * @param {Array<String>} tags - list of git release tags
 * @return {String}
 */
function getPreviousRelease(version, tags) {
    tags = _.clone(tags);

    let pkgVersionLocation = tags.indexOf(version);
    if (pkgVersionLocation === -1) {
        tags.push(version);
        tags = filterAndSortTags(tags);
        pkgVersionLocation = tags.indexOf(version);
        return tags[pkgVersionLocation + 1] || version;
    }

    return version;
}

/**
 * outputs list of valid semver version tags
 * sorted from highest version to lowest
 *
 * @param {Array<String>} tags
 * @return {Array<String>}
 */
function filterAndSortTags(tags) {
    tags = tags.filter(function(tag) {
        return semver.valid(tag);
    });

    return sortVersions(tags);
}

/**
 * sorted from highest version to lowest
 *
 * @param {Array<String>} tags
 * @return {Array<String>}
 */
function sortVersions(tags) {
    return tags.sort(function(a, b) {
        if (semver.gt(a, b)) {//a is grater than b
            return -1;
        } else if (semver.eq(a, b)) {
            return 0;
        } else {
            return 1;
        }
    });
}

/**
 * comares two sql strings and returns a new lines added to str since the oldStr
 * (the latest release). If changes are detected in the str that has been already
 * released in oldStr it will fail with an Error
 *
 * @param {String} oldStr - the latest released data
 * @param {String} str - current data
 * @return {String}
 */
function getNewLines(oldStr, str) {

    oldStr = ~['undefined', 'object'].indexOf(typeof oldStr) ? '' : oldStr;
    str = ~['undefined', 'object'].indexOf(typeof str) ? '' : str;

    if (oldStr === str) {
        return '';
    } else if (!oldStr) {
        return str;
    }

    let oldLines = oldStr.trim().split('\n')
    ,   lines    = str.trim().split('\n');

    for (let i = 0, len = oldLines.length; i < len; i++) {
        if (oldLines[i] !== lines[i]
            && (typeof lines[i] !== 'string'
                || lines[i].indexOf('--') !== 0 //the change is NOT a sql comment
                || (typeof oldLines[i] !== 'string'
                    || oldLines[i].indexOf('--') !== 0 //the change is NOT a sql comment
                )
            )
        ) {
            throw new Error('Inconsistent data changes detected. Only adding of new lines and edition of comments is allowed');
        }
    }

    return lines.slice(oldLines.length).join('\n');
}

/**
 * finds all occurances of {require:<table_name>} in sql file
 * and returns them as an Array of reuired tables
 *
 * @param {String} str - .sql file content
 * @return {Array<String>}
 */
function getRequiredTables(str) {
    var out = []
    ,   matches
    ,   regex = /(?:{require:)([\w-_]+)(?:})/g;

    while (matches = regex.exec(str)) {
        out.push(matches[1]);
    }

    return out;
}

/**
 * example of input array:
 * [{
 *     table: 'country',
 *     version: 'v2',
 *     requires: ['state'],
 *     seedDataDelta: 'new db table data inserts / updates',
 *     schemaDataDelta: 'new db table schema changes'
 * }]
 *
 *
 * @param {Array<Object>} tables
 *
 * @return {Array<Object>}
 */
function filterAndSortTables(tables) {
    tables = tables.filter(function(table) {
        return table.seedDataDelta || table.schemaDataDelta;
    });

    return sortTables(tables);
}

/**
 * @param {Array<Object>} tables
 * @return {Array} - sorted input array
 */
function sortTables(tables) {
    let _found = {};
    let _moveJobs = {};

    for (var i = 0, len = tables.length; i < len; i++) {
        let table = tables[i];

        if (_moveJobs.hasOwnProperty(table.table)) {
            let movIndex = _moveJobs[table.table];
            //place table to new location index
            if (movIndex < 0) {
                tables.unshift(table);
            } else {
                tables.splice(movIndex, 0, table);
            }
            //remove the table from its previous index position
            tables.splice((movIndex > i ? i : i+1), 1);
            return sortTables(tables);
        }

        for (var y = 0, len2 = table.requires.length; y < len2; y++) {
            let requiredTable = table.requires[y];
            if (!_found.hasOwnProperty(requiredTable)) {
                _moveJobs[requiredTable] = i-1;
                continue;
            }
        }
        _found[table.table] = i;
    }
    return tables;
    //TODO
    //throw new Error(`Tables ${table.name} & ${table2.name} can NOT require each other. Failed to resolve dependencies.`);
}

/**
 * @param {Array<Object>} tables
 * @param {String} version - semver tag under which to save the migration, exceptionally it can equal "development" string
 * @param {String} migDir - directory of migrations
 * @param {String} provider - mysql|postgres
 * @param {String} type - sql|js
 *
 * @return {Promise}
 */
function createMigration(tables, version, migDir, provider, type) {
    let seedData   = ''
    ,   interpolatedData = ''
    ,   ext        = '.' + type
    ,   _path      = path.resolve(migDir + path.sep + version + ext)
    ,   data       = ''
    ,   schemaData = '';

    tables.forEach(function(table, index, arr) {
        if (table.schemaDataDelta) {
            schemaData += table.schemaDataDelta;
            interpolatedData = appendToNewLine(interpolatedData, table.schemaDataDelta);
        }

        if (table.seedDataDelta) {
            seedData += table.seedDataDelta;
            interpolatedData = appendToNewLine(interpolatedData, table.seedDataDelta);
        }

        if (index !== arr.length -1) {
            seedData += '\n';
            schemaData += '\n';
        }
    });

    let template;
    if (type === 'sql') {
        template = provider;
    } else {
        template = 'js';
    }

    data = renderTemplate(template, {
        schema: schemaData,
        interpolatedData: interpolatedData,
        seed: seedData,
        migName: 'migration_' + version.replace(/[\.-]/g, '')
    });

    return fs.writeFileAsync(_path, data).return(_path);
}

/**
 * @param {String} target
 * @param {String} data
 * @return {String}
 */
function appendToNewLine(target, data) {
    if (typeof target === 'string'
        && target[target.length -1] !== '\n'
        || target[target.length -2] !== '\n'
    ) {
        target += '\n';
    }

    target += data;

    return target;
}

/*
 * @param {String} path
 * @return {String}
 */
function _removeTrailingSlash(p) {
    if (p.indexOf(path.sep) === 0) {
        return p.slice(1);
    }
    return p;
}

/**
 * synchronous helper function
 * recursivelly iterates over file hiearchy
 *
 * @public
 * @param {Array|String} paths
 * @param {Object} [options]
 * @param {Array} [options.except] - collection of files/directories that should be excluded
 * @param {Function} callback(file, dirPath)
 *
 * @return {undefined}
 */
function _fileIterator(paths, options, callback) {
    var filePacks = [];
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    if (typeof paths === 'string') {
        paths = [paths];
    }

    options = options || {};
    var except = [];

    //normalize paths
    (options.except || []).forEach(function(p) {
        except.push(path.resolve(p));
    });

    paths.forEach(function(path) {
        filePacks.push(fs.readdirSync(path));
    });

    filePacks.forEach(function(files, index) {
        files.forEach(function(file) {
            var pth = path.join(paths[index], file);
            var isDir = fs.lstatSync(pth).isDirectory();

            //skip paths defined in options.except array
            if (except.indexOf(pth) !== -1) {
                return;
            }

            if (isDir) {
                _fileIterator([pth], options, callback);
            } else {
                callback(file, paths[index]);
            }
        });
    });
}
