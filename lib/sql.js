let dialects = {
    mysql: {},
    postgres: {}
};

module.exports = dialects;


/**
 * @param {String} version
 * @return {STring}
 */
function _getProcedureName(version) {
    return 'migration_' + version.replace(/[\.-]/g, '');
}

/**
 * @param {String} str
 * @param {String} pad
 * @return {String}
 */
function _prettyPrint(str, pad) {
    return str.trim().split('\n').reduce(function(str, line, index) {
        if (line) {
            str += pad + line + '\n';
        } else {
            str += '\n';
        }
        return str;
    }, '');
}


/*
 * @param {String} schema
 * @param {String} seed
 * @return {String}
 */
dialects.postgres.main = function main(schema, seed) {
    return 'DO $$\n' +
        '-- Start transaction immediately\n' +
        'BEGIN\n' +
        '-- SCHEMA CHANGES\n' +
            _prettyPrint(schema, '    ') +
        '\n' +
        '-- DATA CHANGES\n' +
            _prettyPrint(seed, '    ') +
        'END\n' +
    '$$;';
}

/*
 * @param {String} schema
 * @param {String} seed
 * @return {String}
 */
dialects.mysql.main = function main(schema, seed, migVersion) {
    let migName = _getProcedureName(migVersion);

    if (seed) {
        seed = '-- DATA CHANGES\n' +
            'SET autocommit=0;\n' +
            'START TRANSACTION;\n' +
            _prettyPrint(seed, '    ') +
            'COMMIT;'
    }

return `DELIMITER $$
DROP PROCEDURE IF EXISTS ${migName} $$

CREATE PROCEDURE ${migName}()
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    -- SCHEMA CHANGES
    -- DDL is not transactional and causes implicit COMMIT;
    -- thus must be executed outside of a transaction
${_prettyPrint(schema, '    ')}
${_prettyPrint(seed, '    ')}
END $$

-- execute migration via the procedure
CALL ${migName}() $$
DROP PROCEDURE IF EXISTS ${migName} $$
DELIMITER ;`
}
