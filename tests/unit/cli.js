const chai  = require('chai');
const yargs = require('yargs');

const cliInterface = require('../../index.js');

chai.should();

describe('yargs cli interface', function() {
    it('should return argv builder object', function() {
        let argvBuilder = cliInterface(yargs, false);
        argvBuilder.should.be.an('object');
        argvBuilder.should.have.property('argv');
        argvBuilder.should.have.property('coerce').that.is.a('function');
        argvBuilder.should.have.property('command').that.is.a('function');
    });
});
