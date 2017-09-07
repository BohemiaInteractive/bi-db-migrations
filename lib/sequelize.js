const sequelizeBuilder = require('bi-service-sequelize');

const metaTableBuilder = require('./meta_table.js');
const index            = require('../index.js');

const config = index.getConfig();

const sequelize = module.exports =  sequelizeBuilder(config.getOrFail('sequelize'));

metaTableBuilder(sequelize, sequelize.Sequelize.DataTypes);
