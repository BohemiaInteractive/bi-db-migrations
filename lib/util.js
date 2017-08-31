const fs           = require('fs');
const Promise      = require('bluebird');
const path         = Promise.promisifyAll(require('path'));
const childProcess = require('child_process');

module.exports.getNearestRepository = getNearestRepository;
module.exports.hasMigrationsStructure = hasMigrationsStructure;
module.exports.initFS = initFS;


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
        return path.statAsync(p).then(function(stat) {
            out.push(stat.isDirectory());
            return null;
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
