const _            = require('lodash');
const Promise      = require('bluebird');
const fs           = Promise.promisifyAll(require('fs'));
const path         = require('path');
const childProcess = require('child_process');

module.exports.getNearestRepository    = getNearestRepository;
module.exports.hasMigrationsStructure  = hasMigrationsStructure;
module.exports.fetchTableMigrations    = fetchTableMigrations;
module.exports.generateSqlCommentFlags = generateSqlCommentFlags;
module.exports.initFS                  = initFS;
module.exports.createFile              = createFile;

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
            let gitStatus = childProcess.spawnSync('git', ['status']);

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
function fetchTableMigrations(migDirPath) {
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
