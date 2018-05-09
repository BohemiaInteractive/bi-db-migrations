const Promise        = require('bluebird');
const _              = require('lodash');
const fs             = Promise.promisifyAll(require('fs'));
const tmp            = require('tmp');
const path           = require('path');
const childProcess   = require('child_process');
const chai           = require('chai');
const Sequelize      = require("sequelize");

global.Promise = Promise;

const expect = chai.expect;

chai.should();

const Migration      = require('../../lib/migration.js');
const utils          = require('../../lib/util.js');
const MigrationError = require('../../lib/error/migrationError.js');
const testUtils      = require('../utils.js');

describe('integration', function() {
    [{
        dialect: 'postgres',
        port: 5432,
        query: fs.readFileSync(__dirname + '/../data/postgres/app/schema.sql').toString() +
               fs.readFileSync(__dirname + '/../data/postgres/app_type/schema.sql').toString(),
        db: process.env.POSTGRES_DB,
        username: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD
    }, {
        dialect: 'mysql',
        port: 3306,
        query: fs.readFileSync(__dirname + '/../data/mysql/app/schema.sql').toString() +
               fs.readFileSync(__dirname + '/../data/mysql/app_type/schema.sql').toString(),
        db: process.env.MYSQL_DATABASE,
        username: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD
    }].forEach(function(vendor) {
        const dialect = vendor.dialect;
        describe(vendor.dialect, function() {

            beforeEach(function() {
                return testUtils.initMigEnv.call(this, '1.1.0').bind(this).then(function() {
                    this.mig.config.set('sequelize', {
                        dialect: dialect,
                        port: vendor.port,
                        host: dialect,
                        db: vendor.db,
                        username: vendor.username,
                        password: vendor.password
                    });
                    this.sequelize = this.mig._getSequelize();
                });
            });

            afterEach(function() {
                this.tmpDir.removeCallback();
            });

            describe(`seedCmd ${dialect}`, function() {
                beforeEach(function() {
                    return testUtils.createMigrationDevDbFiles.call(
                        this, this.mig, this.tmpDir.name
                    ).bind(this).then(function() {
                        return this.sequelize.query(vendor.query);
                    });
                });

                afterEach(function() {
                    return Promise.all([
                        this.sequelize.query(`drop table app;`),
                        this.sequelize.query(`drop table app_type;`)
                    ]);
                });

                it('should generate and execute data seeding sql query with contents of $TMP_DIR/migrations/src/app_type/data.sql', function() {
                    let expectedSeedData = fs.readFileSync(
                        path.resolve(__dirname + `/../assertion_files/seedCmd_app_type.${dialect}`)
                    );

                    return this.mig.seedCmd({
                        'mig-dir': 'migrations',
                        table: 'app_type',
                    }).bind(this).then(function() {
                        return this.sequelize.query(
                            'select * from app_type order by id desc;'
                        );
                    }).then(function(result) {
                        result.should.be.instanceof(Array);
                        result[0].should.have.deep.members([{
                            id: 1,
                            name: 'foreign'
                        }, {
                            id: 2,
                            name: 'native'
                        }]);
                    });
                });

                it('should generate and execute data seeding sql query for all tables in $TMP_DIR/migrations/src/', function() {
                    let expectedSeedData = fs.readFileSync(
                        path.resolve(__dirname + `/../assertion_files/seedCmd.${dialect}`)
                    );

                    return this.mig.seedCmd({
                        'mig-dir': 'migrations',
                    }).bind(this).then(function() {
                        return Promise.all([
                            this.sequelize.query('select * from app_type;'),
                            this.sequelize.query('select * from app;'),
                        ]);
                    }).then(function(results) {
                        results[0].should.be.instanceof(Array);
                        results[0][0].should.be.instanceof(Array);
                        results[1].should.be.instanceof(Array);
                        results[1][0].should.be.instanceof(Array);

                        results[0][0].should.have.deep.members([
                            {
                                id: 1,
                                name: 'foreign'
                            }, {
                                id: 2,
                                name: 'native'
                            }
                        ]);
                        results[1][0].should.have.deep.members([
                            {
                                id: 'test1',
                                name: 'Arma 1',
                                app_type_id: 1
                            },
                            {
                                id: 'test2',
                                name: 'Arma 2',
                                app_type_id: 2
                            },
                            {
                                id: 'test3',
                                name: 'Arma 3',
                                app_type_id: 2
                            },
                        ]);
                    });
                });
            });

            describe('fetchMigrationState', function() {
                it('should create migrations table and return null as no migrations were run', function() {
                    return utils.fetchMigrationState(
                        this.sequelize.modelManager.getModel('migrations')
                    ).bind(this).then(function(state) {

                        expect(state).to.be.equal(null);
                        return this.sequelize.query(
                            'select * from migrations;'
                        ).should.be.fulfilled;
                    });
                });
            });
        });
    });
});
