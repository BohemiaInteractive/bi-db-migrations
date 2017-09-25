const Promise        = require('bluebird');
const _              = require('lodash');
const fs             = Promise.promisifyAll(require('fs'));
const tmp            = require('tmp');
const path           = require('path');
const childProcess   = require('child_process');
const chai           = require('chai');
const sinon          = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const sinonChai      = require("sinon-chai");

//this makes sinon-as-promised available in sinon:
require('sinon-as-promised');

const expect = chai.expect;

chai.should();
chai.use(sinonChai);
chai.use(chaiAsPromised);

const Migration = require('../lib/migration.js');

before(function() {
    this.spawnSync = function(cmd, args, options) {
        let result = childProcess.spawnSync(cmd, args, options);

        if (result.status !== 0) {
            throw new Error(`${cmd} ${args.join(' ')} exited with status code ${result.status}. ${result.stderr && result.stderr.toString()}`)
        }

        if (result.error) {
            throw result.error;
        }

        return result.stdout;
    };

    this.initGitRepo = function(dir) {
        let result = childProcess.spawnSync('git', ['init'], {cwd: dir});

        if (result.error) {
            throw gitStatus.error;
        } else if (result.status !== 0) {
            throw new Error('`git init` exited with status: ' + result.status);
        }
    };

    this.initMigEnv = function(pkgVersion) {
        this.tmpDir = tmp.dirSync({unsafeCleanup: true});
        this.initGitRepo(this.tmpDir.name);
        this.mig = new Migration({
            root: this.tmpDir.name
        });

        let pkg = '{"name": "test", "version": "'+pkgVersion+'"}';

        this.packagePath = path.resolve(this.tmpDir.name + `/package.json`);
        return fs.writeFileAsync(this.packagePath, pkg);
    };

    this.createMigrationDevDbFiles = function(mig, root) {
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
            let appSchemaData     = fs.readFileSync(path.resolve(__dirname + '/data/app/schema.sql'));
            let appSeedData       = fs.readFileSync(path.resolve(__dirname + '/data/app/data.sql'));
            let appTypeSchemaData = fs.readFileSync(path.resolve(__dirname + '/data/app_type/schema.sql'));
            let appTypeSeedData   = fs.readFileSync(path.resolve(__dirname + '/data/app_type/data.sql'));

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
});

describe('bi-service-sequelize-migrations', function() {
    before(function() {
        tmp.setGracefulCleanup();
    });

    _.forEach({
        initSeedCmd: 'data',
        initSchemaCmd: 'schema'
    }, function(fName, methodName) {
        describe(methodName, function() {
            before(function() {
                return this.initMigEnv('1.1.0');
            });

            after(function() {
                this.tmpDir.removeCallback();
            });

            it(`should create $TMP_DIR/migrations/src/country/${fName}.sql file`, function() {
                return this.mig[methodName]({
                    table: 'country',
                    'mig-dir': 'migrations'
                }).bind(this).then(function() {
                    let p = path.resolve(this.tmpDir.name + `/migrations/src/country/${fName}.sql`);
                    return fs.statAsync(p).then(function(stat) {
                        expect(stat.isFile()).to.be.equal(true, `${p} does not exists`);
                    });
                });
            });

            it(`should include "{require:app_type}" && "{require:language}" flags at the beginning of created ${fName} file`, function() {
                return this.mig[methodName]({
                    table: 'app',
                    'mig-dir': 'migrations',
                    require: ['app_type', 'language']
                }).bind(this).then(function() {
                    let p = path.resolve(this.tmpDir.name + `/migrations/src/app/${fName}.sql`);
                    return fs.readFileAsync(p).then(function(data) {
                        data.toString().should.be.equal(`-- {require:app_type}\n-- {require:language}\n`);
                    });
                });
            });

            it('should fail with File already exists error', function() {
                let opt = {
                    table: 'state',
                    'mig-dir': 'migrations',
                };
                return this.mig[methodName](opt).bind(this).then(function() {
                    return this.mig[methodName](opt);
                }).should.be.rejected.then(function(err) {
                    err.message.should.match(/file already created at/);
                });
            });
        });
    });

    describe('initMigrationCmd', function() {
        describe('no release tag created yet', function() {
            before(function() {
                return this.initMigEnv('1.1.0').bind(this).then(function() {
                    return this.createMigrationDevDbFiles(this.mig, this.tmpDir.name);
                });
            });

            after(function() {
                this.tmpDir.removeCallback();
            });

            ['mysql', 'postgres'].forEach(function(dialect) {
                it(`should create $TMP_DIR/migrations/1.1.0.sql migration file for ${dialect}`, function() {
                    return this.mig.initMigrationCmd({
                        'mig-dir': 'migrations',
                        type: 'sql',
                        dialect: dialect
                    }).bind(this).then(function() {
                        let p = path.resolve(this.tmpDir.name + `/migrations/1.1.0.sql`);
                        return fs.statAsync(p).then(function(stat) {
                            expect(stat.isFile()).to.be.equal(true, `${p} does not exists`);
                            return fs.readFileAsync(p);
                        }).then(function(data) {
                            data.toString().should.be.equal(
                                fs.readFileSync(__dirname + `/assertion_files/1.1.0.${dialect}`).toString()
                            );
                        });
                    });
                });
            });
        });

        describe('semver release git tag already exists with a migration sql script', function() {
            before(function() {
                return this.initMigEnv('1.1.0').bind(this).then(function() {
                    return this.createMigrationDevDbFiles(this.mig, this.tmpDir.name);
                }).then(function() {
                    return this.mig.initMigrationCmd({
                        'mig-dir': 'migrations',
                        type: 'sql',
                        dialect: 'postgres'
                    });
                }).then(function() {
                    this.spawnSync('git', [
                        'add',
                        'migrations'
                    ], {cwd: this.tmpDir.name});

                    this.spawnSync('git', [
                        'commit',
                        '-m',
                        'initial'
                    ], {cwd: this.tmpDir.name});

                    this.spawnSync('git', [
                        'tag',
                        '-a',
                        '1.1.0',
                        '-m',
                        'initial'
                    ], {cwd: this.tmpDir.name});

                    let migSrcPath =  path.resolve(this.tmpDir.name + `/migrations/src/`);

                    let appSchemaData     = 'ALTER TABLE ONLY app ADD CONSTRAINT app_pkey PRIMARY KEY (id);';
                    let appSeedData       = "INSERT INTO app (id, name, app_type_id) VALUES ('test7', 'Arma 7', 2);";
                    let appTypeSchemaData = 'ALTER TABLE ONLY app_type ADD CONSTRAINT app_type_name_key UNIQUE (name);';

                    let fdAppSchema     = fs.openSync(migSrcPath + '/app/schema.sql', 'a');
                    let fdAppSeed       = fs.openSync(migSrcPath + '/app/data.sql', 'a');
                    let fdAppTypeSchema = fs.openSync(migSrcPath + '/app_type/schema.sql', 'a');

                    fs.writeSync(fdAppSchema, appSchemaData);
                    fs.writeSync(fdAppSeed, appSeedData);
                    fs.writeSync(fdAppTypeSchema, appTypeSchemaData);

                    fs.closeSync(fdAppSchema);
                    fs.closeSync(fdAppSeed);
                    fs.closeSync(fdAppTypeSchema);

                    let pkg = '{"name": "test", "version": "1.2.0"}';
                    return fs.writeFileAsync(this.packagePath, pkg);
                });
            });

            after(function() {
                this.tmpDir.removeCallback();
            });

            it('should create a new migration file with changes since last git release tag', function() {
                return this.mig.initMigrationCmd({
                    'mig-dir': 'migrations',
                    type: 'sql',
                    dialect: 'postgres'
                }).bind(this).then(function() {
                    let p = path.resolve(this.tmpDir.name + `/migrations/1.2.0.sql`);
                    return fs.statAsync(p).then(function(stat) {
                        expect(stat.isFile()).to.be.equal(true, `${p} does not exists`);
                        return fs.readFileAsync(p);
                    }).then(function(data) {
                        data.toString().should.be.equal(
                            fs.readFileSync(__dirname + `/assertion_files/1.2.0.postgres`).toString()
                        );
                    });
                });
            });
        });
    });
});
