const _            = require('lodash');
const Promise      = require('bluebird');
const fs           = Promise.promisifyAll(require('fs'));
const path         = require('path');
const semver       = require('semver');
const childProcess = require('child_process');

module.exports.getNearestRepository         = getNearestRepository;
module.exports.hasMigrationsStructure       = hasMigrationsStructure;
module.exports.fetchMigrationTables         = fetchMigrationTables;
module.exports.populateMigrationDefinitions = populateMigrationDefinitions;
module.exports.generateSqlCommentFlags      = generateSqlCommentFlags;
module.exports.initFS                       = initFS;
module.exports.createFile                   = createFile;
module.exports.gitGetFile                   = gitGetFile;
module.exports.getGitTagList                = getGitTagList;
module.exports.filterAndSortTags            = filterAndSortTags;
module.exports.getNewLines                  = getNewLines;
module.exports.getRequiredTables            = getRequiredTables;
module.exports.filterAndSortTables          = filterAndSortTables;

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

            if (gitStatus.status === 0
                && fs.existsSync(p + '/package.json')
            ) {
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
 * checks whether the project already has valid migrations file system structure
 * in place or it needs to be initialized or there are some conflicts in fs structure.
 *
 * @private
 * @param {String} projectRoot
 * @param {String} migDirName
 * @return {Promise<Boolean>}
 */
function hasMigrationsStructure(projectRoot, migDirName) {
    return Promise.reduce([
        path.resolve(projectRoot + '/' + migDirName),
        path.resolve(projectRoot + '/' + migDirName + '/src'),
    ], function(out, p) {
        return fs.statAsync(p).then(function(stat) {
            out.push(stat.isDirectory());
            return out;
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
            throw new Error(`Inconsistent ${migDirName} fs structure`);
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
    fs.mkdirSync(`${projectRoot}/${migDirName}`);
    fs.mkdirSync(`${projectRoot}/${migDirName}/src`);
    fs.writeFileSync(`${projectRoot}/${migDirName}/README.md`, '');
}


/**
 * @example
 *
 * $migrations/src/country
 * $migrations/src/country_v1
 * $migrations/src/country_v2
 *
 * will result in list of (in the specified order):
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
 * @example
 *
 * //inpurt is expected to be part of the output of fetchMigrationTables()
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
 * @return {Object}
 */
function populateMigrationDefinitions(tableMigrations, latestTag, projectRoot) {
    return Promise.map(tableMigrations, function(mig) {
        let seedPath = path.resolve(mig.path + path.sep + 'seed.sql')
        ,   schemaPath = path.resolve(mig.path + path.sep + 'schema.sql')
        ,   gitSeedPath
        ,   gitSchemaPath;

        if (seedPath.indexOf(projectRoot) === 0) {
            gitSeedPath = seedPath.slice(projectRoot.length);
            gitSeedPath = _removeTrailingSlash(gitSeedPath);
        }

        if (schemaPath.indexOf(projectRoot) === 0) {
            gitSchemaPath = schemaPath.slice(projectRoot.length);
            gitSchemaPath = _removeTrailingSlash(gitSchemaPath);
        }

        if (global.verbose >= 2) {
            console.log(`Reading file: ${seedPath}`);
            console.log(`Reading file: ${schemaPath}`);
            console.log(`Reading git file ${latestTag}:${gitSeedPath}`);
            console.log(`Reading git file ${latestTag}:${gitSeedPath}`);
        }

        return Promise.props({
            seed      : fs.readFileAsync(seedPath).reflect(),
            schema    : fs.readFileAsync(schemaPath).reflect(),
            oldSeed   : gitGetFile(gitSeedPath,latestTag,projectRoot).reflect(),
            oldSchema : gitGetFile(gitSchemaPath,latestTag,projectRoot).reflect(),
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
        return fs.writeSync(fd, data);
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

    return tags.sort(function(a, b) {
        if (semver.gt(b, a)) {//a is grater than b
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
            console.log(oldLines);
            console.log(lines);
            console.log(i);
            console.log(lines[i]);
            console.log(oldLines[i]);
            console.log(oldLines[i] !== lines[i])
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
 * @param {Array<Object>} tables
 *
 * @return {Array<Object>}
 */
function filterAndSortTables(tables) {
    tables = tables.filter(function(table) {
        return table.seedDataDelta || table.schemaDataDelta;
    });

    return tables.sort(function(a,b) {
        if (~a.requires.indexOf(b.table) && !b.requires.indexOf(a.table)) {
            return 0;
        } else if (~a.requires.indexOf(b.table)) {
            return 1;
        } else {
            return -1;
        }
    });
}


/**
 * @param {Array<Object>} tables
 * @param {String} version - semver tag under which to save the migration, exceptionally it can equal "development" string
 * @param {String} migDir - directory of migrations
 *
 * @return {Promise}
 */
function createMigrationFile(tables, version, migDir) {
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
