const childProcess = require('child_process');
const Promise      = require('bluebird');
const fs           = Promise.promisifyAll(require('fs'));
const tmp          = require('tmp');
const path         = require('path');

const Migration = require('../lib/migration.js');

const utils = exports;

exports.spawnSync = function(cmd, args, options) {
    let result = childProcess.spawnSync(cmd, args, options);

    if (result.status !== 0) {
        throw new Error(`${cmd} ${args.join(' ')} exited with status code ${result.status}. ${result.stderr && result.stderr.toString()}`);
    }

    if (result.error) {
        throw result.error;
    }

    return result.stdout;
};

exports.initGitRepo = function(dir) {
    let result = childProcess.spawnSync('git', ['init'], {cwd: dir});

    if (result.error) {
        throw gitStatus.error;
    } else if (result.status !== 0) {
        throw new Error('`git init` exited with status: ' + result.status);
    }
};

exports.initMigEnv = function(pkgVersion, options) {
    options = options || {git: true}
    this.tmpDir = tmp.dirSync({unsafeCleanup: true});
    if (options.git) {
        utils.initGitRepo(this.tmpDir.name);
    }
    this.mig = new Migration({
        root: this.tmpDir.name
    });

    let pkg = '{"name": "test", "version": "'+pkgVersion+'"}';

    this.packagePath = path.resolve(this.tmpDir.name + `/package.json`);
    return fs.writeFileAsync(this.packagePath, pkg);
};

exports.createMigrationDevDbFiles = function(mig, root, dialect) {
    dialect = dialect || 'postgres';

    let optApp = {
        table: 'app',
        'mig-dir': 'migrations',
        require: ['app_type']
    };

    let optAppType = {
        table: 'app_type',
        'mig-dir': 'migrations',
        require: []
    };

    let migSrcPath =  path.resolve(root + `/migrations/src/`);

    return Promise.all([
        mig.initSchemaCmd(optApp),
        mig.initSeedCmd(optApp),
        mig.initSchemaCmd(optAppType),
        mig.initSeedCmd(optAppType),
    ]).then(function() {
        let appSchemaData     = fs.readFileSync(path.resolve(__dirname + `/data/${dialect}/app/schema.sql`));
        let appSeedData       = fs.readFileSync(path.resolve(__dirname + `/data/${dialect}/app/data.sql`));
        let appTypeSchemaData = fs.readFileSync(path.resolve(__dirname + `/data/${dialect}/app_type/schema.sql`));
        let appTypeSeedData   = fs.readFileSync(path.resolve(__dirname + `/data/${dialect}/app_type/data.sql`));

        let fdAppSchema     = fs.openSync(migSrcPath + '/app/schema.sql', 'a');
        let fdAppSeed       = fs.openSync(migSrcPath + '/app/data.sql', 'a');
        let fdAppTypeSchema = fs.openSync(migSrcPath + '/app_type/schema.sql', 'a');
        let fdAppTypeSeed   = fs.openSync(migSrcPath + '/app_type/data.sql', 'a');

        fs.writeSync(fdAppSchema, appSchemaData.toString());
        fs.writeSync(fdAppSeed, appSeedData.toString());
        fs.writeSync(fdAppTypeSchema, appTypeSchemaData.toString());
        fs.writeSync(fdAppTypeSeed, appTypeSeedData.toString());

        fs.closeSync(fdAppSchema);
        fs.closeSync(fdAppSeed);
        fs.closeSync(fdAppTypeSchema);
        fs.closeSync(fdAppTypeSeed);
    });
};
