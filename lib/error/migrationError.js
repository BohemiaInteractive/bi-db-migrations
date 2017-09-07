var util = require('util');

module.exports = MigrationError;

/**
 * @constructor
 * @extends Error
 **/
function MigrationError(message, context) {
    Error.call(this);
    Error.captureStackTrace(this, this.constructor);

    this.name     = this.constructor.name;
    this.message  = message;
    this.context  = context;
}


/**
 * @return {Object}
 */
MigrationError.prototype.toJSON = function() {
    return {
        message: this.message,
        reason: (this.context && this.context.message),
        stack: (this.context && this.context.stack) || this.stack,
    };
};

util.inherits(MigrationError, Error);
