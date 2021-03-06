const Promise        = require('bluebird');
const _              = require('lodash');
const path           = require('path');
const chai           = require('chai');
const sinon          = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const sinonChai      = require("sinon-chai");
const Sequelize      = require('sequelize');

const MigrationError   = require('../../lib/error/migrationError.js');
const MigrationStatus  = require('../../lib/migrationStatus.js');
const Migration        = require('../../lib/migration.js');
const metaTableBuilder = require('../../lib/meta_table.js');
const utils            = require('../../lib/util.js');

global.Promise = Promise;

//this makes sinon-as-promised available in sinon:
require('sinon-as-promised');

const expect = chai.expect;

chai.should();
chai.use(sinonChai);
chai.use(chaiAsPromised);


describe('getNewLines', function() {

    [
        {
            previous: 'line 1 \n line 2',
            current: 'line 1 \n line 2\n line 3',
            expectedOuput: ' line 3'
        },
        {
            previous: '',
            current: 'line 1\nline 2',
            expectedOuput: 'line 1\nline 2'
        },
        {
            previous: 'line 1\nline 2',
            current: 'line 1\nline 2',
            expectedOuput: ''
        },
    ].forEach(function(dataSet, index) {
        it(`should return new lines which have been added since the last revision (${index})`, function() {
            utils.getNewLines(dataSet.previous, dataSet.current).should.be.equal(dataSet.expectedOuput);
        });
    });

    it('should allow to edit sql comments added in previous revision', function() {
        let prevRevision = '-- sql comment\nline 1\nline2';
        let current = '-- edited sql comment\nline 1\nline2';
        let expected = '';

        expect(function() {
            utils.getNewLines(prevRevision, current).should.be.equal(expect);
        });
    });

    it('should fail when non-commented lines of previous revisions have been altered', function() {
        let prevRevision = 'line 1\nline 2';
        let current = 'line 0\nline 2';

        expect(function() {
            utils.getNewLines(prevRevision, current);
        }).to.throw(Error);
    });
});

describe('filterAndSortTables', function() {

    before(function() {
        this.assertArrayOrder = function(sortedArr, unsortedArr, order) {
            let expected = [];

            order.forEach(function(index) {
                expected.push(unsortedArr[index]);
            });

            sortedArr.should.be.eql(expected);
        };
    });

    it(`should include only tables which have some new changes in the output collection`, function() {
        let input = [
            {
                table: 'app_type',
                version: 'v2',
                requires: [],
                seedDataDelta: '',
                schemaDataDelta: 'alter table app_type add column created_at timestamp with timezone'
            },
            {
                table: 'state',
                version: 'v2',
                requires: [],
                seedDataDelta: "",
                schemaDataDelta: ''
            },
            {
                table: 'country',
                version: 'v2',
                requires: ['state'],
                seedDataDelta: "insert into country (id, name) values (null, 'newname')",
                schemaDataDelta: ''
            },
            {
                table: 'app',
                version: 'v2',
                requires: [],
                seedDataDelta: "insert into app (id, name) values (2, 'appname')",
                schemaDataDelta: 'alter table app add column created_at timestamp with timezone'
            },
        ];

        let output = _.cloneDeep(input);
        output.splice(1,1);

        utils.filterAndSortTables(input).should.be.eql(output);
    });

    [
        {
            input: [
                {
                    table: 'app',
                    version: 'v2',
                    requires: ['app_type'],
                    seedDataDelta: "1",
                },
                {
                    table: 'app_type',
                    version: 'v2',
                    requires: [],
                    seedDataDelta: '1',
                },
            ],
            expectedOrder: [1,0]
        },
        {
            input: [
                {
                    table: 'app',
                    version: 'v2',
                    requires: ['app_type', 'country'],
                    seedDataDelta: "1",
                },
                {
                    table: 'country',
                    version: 'v2',
                    requires: ['state'],
                    seedDataDelta: "1",
                },
                {
                    table: 'app_type',
                    version: 'v2',
                    requires: [],
                    seedDataDelta: '1'
                },
                {
                    table: 'state',
                    version: 'v2',
                    requires: [],
                    seedDataDelta: "1",
                },
            ],
            expectedOrder: [3,2,1,0]
        }
    ].forEach(function(dataset, index) {
        it(`should sort tables so that migration dependencies will be included before the dependent ${index}`, function() {
            let sorted = utils.filterAndSortTables(dataset.input);

            this.assertArrayOrder(sorted, dataset.input, dataset.expectedOrder);
        });
    });
});

describe('fetchMigrationState', function() {
    before(function() {
        this.sequelize = new Sequelize('test', 'unknown', 'unknown', {
            host: 'unknown',
            port: 'unknwon',
            dialect: 'postgres',
        });

        metaTableBuilder(this.sequelize, Sequelize.DataTypes);

        this.Migrations = this.sequelize.modelManager.getModel('migrations');
        this.findAllStub = sinon.stub(this.Migrations, 'findAll');
        this.syncStub = sinon.stub(this.Migrations, 'sync');
    });

    beforeEach(function() {
        this.findAllStub.reset();
        this.syncStub.reset();
    });

    after(function() {
        this.findAllStub.restore();
        this.syncStub.restore();
    });

    it('should return the highest migrated version', function() {
        this.findAllStub.resolves([
            {version: '1.0.0-alpha'},
            {version: '1.0.0'},
            {version: '1.0.1'}
        ]);

        return utils.fetchMigrationState(this.Migrations).then(function(state) {
            state.should.be.equal('1.0.1');
        });
    });

    it('should return rejected Promise with MigrationError when there is a pending migration', function() {
        this.findAllStub.resolves([
            {version: '1.0.0-alpha'},
            {version: '1.0.0', status: MigrationStatus.PENDING},
            {version: '1.0.1'}
        ]);

        return utils.fetchMigrationState(this.Migrations).should.be.rejectedWith(MigrationError);
    });

    it('should attempt to create the migration meta table if it does not exist', function() {

        const err = new Error('test error - table migrations does not exist');
        err.original = {
            code: '42P01'
        };

        this.findAllStub.onFirstCall().rejects(err);
        this.findAllStub.onSecondCall().resolves([]);
        this.syncStub.resolves();

        return utils.fetchMigrationState(this.Migrations).then(function(state) {
            expect(state).to.be.equal(null);
        });
    });

    it('should return resolved promise with null when there have been no migrations yet', function() {
        this.findAllStub.resolves([]);

        return utils.fetchMigrationState(this.Migrations).then(function(state) {
            expect(state).to.be.equal(null);
        });
    });
});

describe('Migration', function() {
    describe('_exit', function() {
        describe('migration.CLI = true', function() {
            before(function() {
                this.mig = new Migration({});
                this.mig.CLI = true;

                this.consoleInfoStub = sinon.stub(console, 'info');
                this.consoleErrorStub = sinon.stub(console, 'error');
                this.processExitStub = sinon.stub(process, 'exit');
            });

            beforeEach(function() {
                this.consoleInfoStub.reset();
                this.consoleErrorStub.reset();
                this.processExitStub.reset();
            });

            after(function() {
                this.consoleInfoStub.restore();
                this.consoleErrorStub.restore();
                this.processExitStub.restore();
            });

            [0, 1].forEach(function(exitCode) {
                it(`should exit with status code ${exitCode}`, function() {
                    this.mig._exit('message', exitCode);
                    this.processExitStub.should.have.been.calledOnce;
                    this.processExitStub.should.have.been.calledWith(exitCode);
                });
            });

            [
                {output: 'stdout', code: 0, stub: 'consoleInfoStub'},
                {output: 'stderr', code: 1, stub: 'consoleErrorStub'},
            ].forEach(function(options) {
                it(`should dump valid json to ${options.output}`, function() {
                    let data = {testing: 'data', arr: [1,2]};
                    this.mig._exit(data, options.code);
                    this[options.stub].should.have.been.calledOnce;
                    this[options.stub].should.have.been.calledWith(
                        JSON.stringify(data, null, 2)
                    );
                });

                it(`should dump a string to ${options.output}`, function() {
                    let message = 'testing message';
                    this.mig._exit(message, options.code);
                    this[options.stub].should.have.been.calledOnce;
                    this[options.stub].should.have.been.calledWith(message);
                });

                it(`should dump an Error in string format to ${options.output}`, function() {
                    let err = new Error('error test');
                    this.mig._exit(err, options.code);
                    this[options.stub].should.have.been.calledOnce;
                    this[options.stub].should.have.been.calledWith('Error: error test');
                });

                it(`should dump an Error in json format to ${options.output}`, function() {
                    let err = new Error('error test');
                    err.toJSON = function toJSON() {
                        return {
                            message: this.message
                        };
                    };

                    this.mig._exit(err, options.code);
                    this[options.stub].should.have.been.calledOnce;
                    this[options.stub].should.have.been.calledWith({message: err.message});
                });
            });
        });

        describe('migration.CLI != true', function() {
            before(function() {
                this.mig = new Migration({});
            });

            it('should return what was given to it as a message argument when exit code == 0', function() {
                ['message', {message: 'message'}, new Error('message')].forEach(function(data) {
                    this.mig._exit(data, 0).should.be.equal(data);
                }, this);
            });

            it('should throw received Error object if exit code > 0', function() {
                let err = new Error('message');
                let mig = this.mig;

                [1,2,3,4,5,6].forEach(function(exitCode) {
                    function testCase() {
                        mig._exit(err, exitCode);
                    }

                    expect(testCase).to.throw(err);
                });
            });

            it('should throw an Error if exit code > 0 and error message was given as first arg', function() {
                let err = 'message';
                let mig = this.mig;

                [1,2,3,4,5,6].forEach(function(exitCode) {
                    function testCase() {
                        mig._exit(err, exitCode);
                    }

                    expect(testCase).to.throw('message');
                });
            });
        });
    });
});
