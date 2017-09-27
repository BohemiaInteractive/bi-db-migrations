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
const Sequelize      = require("sequelize");

//this makes sinon-as-promised available in sinon:
require('sinon-as-promised');

const expect = chai.expect;

chai.should();
chai.use(sinonChai);
chai.use(chaiAsPromised);

const Migration = require('../../lib/migration.js');
const utils     = require('../../lib/util.js');

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
            let appSchemaData     = fs.readFileSync(path.resolve(__dirname + '/../data/app/schema.sql'));
            let appSeedData       = fs.readFileSync(path.resolve(__dirname + '/../data/app/data.sql'));
            let appTypeSchemaData = fs.readFileSync(path.resolve(__dirname + '/../data/app_type/schema.sql'));
            let appTypeSeedData   = fs.readFileSync(path.resolve(__dirname + '/../data/app_type/data.sql'));

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

describe('acceptance', function() {
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
                                fs.readFileSync(__dirname + `/../assertion_files/1.1.0.${dialect}`).toString()
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
                            fs.readFileSync(__dirname + `/../assertion_files/1.2.0.postgres`).toString()
                        );
                    });
                });
            });

            it('should include only the highest available version of folder with database table changes in generated migration', function() {
                //eg.: if thwo folders migrations/src/country & migrations/src/country_v2 are in place, then it should ignore "/src/country" directory
                let appPath = path.resolve(this.tmpDir.name + '/migrations/src/app_v2');
                let appTypePath = path.resolve(this.tmpDir.name + '/migrations/src/app_type_v2');

                return Promise.all([
                    fs.mkdirAsync(appTypePath),
                    fs.mkdirAsync(appPath),
                ]).then(function() {
                    let prom1 = fs.writeFileAsync(
                        appPath + '/schema.sql',
                        '-- {require:app_type}\n' +
                        'CREATE TABLE app (\n' +
                        '    id SERIAL PRIMARY KEY,\n' +
                        '    app_type_id integer,\n' +
                        ');\n'
                    );

                    let prom2 = fs.writeFileAsync(
                        appTypePath + '/schema.sql',
                        'CREATE TABLE app_type (\n' +
                        '    id SERIAL PRIMARY KEY,\n' +
                        '    name character varying(255),\n' +
                        ');\n'
                    );

                    return Promise.all([prom1, prom2]);
                }).bind(this).then(function() {
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
                                fs.readFileSync(__dirname + `/../assertion_files/1.2.0_v2.postgres`).toString()
                            );
                        });
                    });
                });
            });
        });
    });

    ['postgres', 'mysql'].forEach(function(dialect) {
        describe(`seedCmd ${dialect}`, function() {
            before(function() {
                return this.initMigEnv('1.1.0').bind(this).then(function() {
                    return this.createMigrationDevDbFiles(this.mig, this.tmpDir.name);
                }).then(function() {
                    this.sequelizeMock = {
                        options: {dialect: dialect},
                        QueryTypes: {
                            SELECT: Sequelize.QueryTypes.SELECT
                        },
                        query: sinon.stub()
                    };

                    this.migratePlainSqlSpy = sinon.spy(utils, 'migratePlainSql');
                    this.getSequelizeStub = sinon.stub(this.mig, '_getSequelize')
                        .returns(this.sequelizeMock)
                });
            });

            afterEach(function() {
                this.getSequelizeStub.reset();
                this.migratePlainSqlSpy.reset();
                this.sequelizeMock.query.reset();
            });

            after(function() {
                this.migratePlainSqlSpy.restore();
                this.getSequelizeStub.restore();
                this.tmpDir.removeCallback();
            });

            it('should generate and execute data seeding sql query with contents of $TMP_DIR/migrations/src/app_type/data.sql', function() {
                this.sequelizeMock.query.returns(Promise.resolve());

                let expectedSeedData = fs.readFileSync(
                    path.resolve(__dirname + `/../assertion_files/seedCmd_app_type.${dialect}`)
                );

                return this.mig.seedCmd({
                    'mig-dir': 'migrations',
                    table: 'app_type',
                }).bind(this).then(function() {
                    this.getSequelizeStub.should.have.been.calledOnce;
                    this.migratePlainSqlSpy.should.have.been.calledOnce;
                    this.sequelizeMock.query.should.have.been.calledOnce;
                    expect(this.sequelizeMock.query.firstCall.args[0] + '')
                        .to.be.equal(expectedSeedData.toString());
                    expect(this.sequelizeMock.query.firstCall.args[1])
                        .to.be.eql({ type: Sequelize.QueryTypes.SELECT });
                });
            });

            it('should generate and execute data seeding sql query for all tables in $TMP_DIR/migrations/src/', function() {
                this.sequelizeMock.query.returns(Promise.resolve());

                let expectedSeedData = fs.readFileSync(
                    path.resolve(__dirname + `/../assertion_files/seedCmd.${dialect}`)
                );

                return this.mig.seedCmd({
                    'mig-dir': 'migrations',
                }).bind(this).then(function() {
                    this.getSequelizeStub.should.have.been.calledOnce;
                    this.migratePlainSqlSpy.should.have.been.calledOnce;
                    this.sequelizeMock.query.should.have.been.calledOnce;
                    expect(this.sequelizeMock.query.firstCall.args[0] + '')
                        .to.be.equal(expectedSeedData.toString());
                    expect(this.sequelizeMock.query.firstCall.args[1])
                        .to.be.eql({ type: Sequelize.QueryTypes.SELECT });
                });
            });
        });
    });

    describe('migrateCmd', function() {

        let fakeMigrations = {
            '1.0.0-alpha' : "select '1.0.0-alpha';\n",
            '1.0.0'       : "select '1.0.0';\n",
            '1.0.1'       : "select '1.0.1';\n",
            '1.1.0'       : "select '1.1.0';\n",
            '2.0.0-alpha' : "select '2.0.0-alpha';\n",
            '2.0.0'       : "select '2.0.0';\n",
        };
        fakeMigrations.sortedVersions = [
            '1.0.0-alpha', '1.0.0', '1.0.1', '1.1.0', '2.0.0-alpha', '2.0.0'
        ];

        before(function() {
            return this.initMigEnv('1.1.0').bind(this).then(function() {
                return utils.initFS(this.tmpDir.name, 'migrations');
            }).then(function() {
                const mig = this.mig;
                const tmpDir = this.tmpDir;

                mig.config.set('sequelize', {
                    host: 'unknown',
                    port: 0,
                    dialect: 'postgres',
                    username: 'unknown',
                    password: 'unknown',
                    db: 'test'
                });

                this.sequelize = mig._getSequelize();
                const Migrations = this.sequelize.modelManager.getModel('migrations');
                sinon.stub(this.sequelize, 'query');
                sinon.stub(Migrations, 'create').returns(Promise.resolve({}));
                sinon.stub(Migrations, 'update').returns(Promise.resolve({}));

                this.fetchMigrationStateStub = sinon.stub(utils, 'fetchMigrationState');
                this.migratePlainSqlSpy = sinon.spy(utils, 'migratePlainSql');
                this.getSequelizeStub = sinon.stub(this.mig, '_getSequelize')
                    .returns(this.sequelize)

                this.fakeMigrations = fakeMigrations;

                return Promise.map(fakeMigrations.sortedVersions, function(version) {
                    let fPath = path.resolve(tmpDir.name + `/migrations/${version}.sql`);
                    return fs.writeFileAsync(fPath, fakeMigrations[version]);
                });
            });
        });

        afterEach(function() {
            this.fetchMigrationStateStub.reset();
            this.getSequelizeStub.reset();
            this.migratePlainSqlSpy.reset();
            this.sequelize.query.reset();
        });

        let assertions = [
            {
                state: null,
                toBeMigrated: fakeMigrations.sortedVersions
            }
        ];

        fakeMigrations.sortedVersions.forEach(function(version, index) {
            assertions.push({
                state: version,
                toBeMigrated: fakeMigrations.sortedVersions.slice(index+1)
            });
        });

        assertions.forEach(function(dataset, index) {
            it(`should execute correct set of migrations relative to current db state so that the db ends up in "up-to-date" state ${index}`, function() {
                this.sequelize.query.returns(Promise.resolve({}))
                this.fetchMigrationStateStub.returns(Promise.resolve(dataset.state));

                return this.mig.migrateCmd({
                    'mig-dir': 'migrations'
                }).bind(this).then(function() {
                    this.fetchMigrationStateStub.should.have.been.calledOnce;
                    dataset.toBeMigrated.forEach(function(version, index) {
                        this.sequelize.query.getCall(index).args[0]
                            .should.be.equal(fakeMigrations[version]);
                    }, this);
                });
            });
        });
    });

    describe('migrationStatusCmd', function() {
        before(function() {
            const mig = new Migration();
            this.mig = mig;

            mig.config.set('sequelize', {
                host: 'unknown',
                port: 0,
                dialect: 'postgres',
                username: 'unknown',
                password: 'unknown',
                db: 'test'
            });

            this.sequelize = mig._getSequelize();
            this.Migrations = this.sequelize.modelManager.getModel('migrations');
            sinon.stub(this.Migrations, 'findAll');
        });

        it('should return resolved promise with database migration state info', function() {
            this.Migrations.findAll.returns(Promise.resolve([
                {
                    created_at : '2017-09-26 19:25',
                    version    : '2.0.0',
                    status     : 'ok',
                    note       : 'note'
                },
                {
                    created_at : '2017-09-26 19:25',
                    version    : '1.0.0',
                    status     : 'error',
                    note       : 'errormsg'
                }
            ]));

            return this.mig.migrationStatusCmd({
                limit: 10
            }).bind(this).then(function(str) {
                this.Migrations.findAll.should.have.been.calledOnce;
                this.Migrations.findAll.should.have.been.calledWith({
                        order: [['id', 'DESC']],
                        limit: 10
                });
                let expected =
                'version  status  created_at        note    \n' +
                '-------  ------  ----------------  --------\n' +
                '2.0.0    ok      2017-09-26 19:25  note    \n' +
                '1.0.0    error   2017-09-26 19:25  errormsg\n';
                str.should.be.equal(expected);
            });
        });
    });
});
