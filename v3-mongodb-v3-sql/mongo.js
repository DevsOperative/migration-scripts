const { MongoClient } = require('mongodb');
const mongoUriBuilder = require('mongo-uri-builder');

const uri = mongoUriBuilder({
  username: process.env.MONGO_USER,
  password: process.env.MONGO_PASSWORD,
  host: process.env.MONGO_HOST,
  port: process.env.MONGO_PORT,
  database: process.env.MONGO_DB,
  replicas: process.env.MONGO_REPLICAS,
  options: process.env.MONGO_OPTIONS,
});

const client = new MongoClient('mongodb://db-prod:cjy2cuJMJHCLyNaz@cluster0-shard-00-00.aof4e.mongodb.net:27017,cluster0-shard-00-01.aof4e.mongodb.net:27017,cluster0-shard-00-02.aof4e.mongodb.net:27017/myFirstDatabase?ssl=true&replicaSet=atlas-cgnbaq-shard-0&authSource=admin&retryWrites=true&w=majority');

module.exports = client;
