

module.exports = function(sequelize, DataTypes) {

    var Model = sequelize.define('migrations', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        version: {
            allowNull: false,
            type: DataTypes.STRING
        },
        status: {
            allowNull: false,
            type: DataTypes.STRING,

        },
        note: {
            allowNull: true,
            type: DataTypes.STRING
        },
    }, {
        timestamps: true,
    });

    return Model;
}
