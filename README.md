# Strapi Migration Scripts

This repository contains notes and scripts to run data migrations between Strapi versions

## Supported Databases

When referring to `SQL` databases we mean officially supported databases by Strapi:

- MySQL >= 5.7.8
- MariaDB >= 10.2.7
- PostgreSQL >= 10
- SQLite >= 3

For more information on supported databases, please see the [deployment guidelines](https://docs.strapi.io/developer-docs/latest/setup-deployment-guides/deployment.html#general-guidelines) in the Strapi documentation.

## How to run
### v3 Mongo to v3 Postgres

#### Setup

Start on the `develop` branch in the `mathmedic-api` repo.
##### Strapi Setup
Create a new user to run Strapi with.  Typically this user will be the owner of the database.
```
psql>CREATE ROLE strapi WITH LOGIN SUPERUSER PASSWORD 'strapi';
```


Create a new database for the v3 tables.  In my environment I created a database called `strapi` database and make sure.
```
psql>CREATE DATABASE strapi OWNER strapi;
```

Update `.env` file in Strapi with new database information.  Install new required dependencies and update config/database.js file for Postgres connection.  

```
npm i pg strapi-connector-bookshelf knex
```

database.js
```
module.exports = ({ env }) => ({
  defaultConnection: 'default',
  connections: {
    default: {
      connector: 'bookshelf',
      settings: {
        client: 'postgres',
        host: env('DATABASE_HOST', 'localhost'),
        port: env.int('DATABASE_PORT', 5432),
        database: env('DATABASE_NAME', 'strapi'),
        username: env('DATABASE_USERNAME', 'strapi'),
        password: env('DATABASE_PASSWORD', 'strapi'),
        schema: env('DATABASE_SCHEMA', 'public'), // Not Required
        ssl: false,
      },
      options: {},
    },
  },
});
```

Finally, start the v3 Strapi against the Postgres database to get the tables generated properly. Once up and running you can kill the process so it isn't in the way.
```
$ yarn build && yarn develop
```


##### Migration Setup
From the `v3-mongodb-v3-sql` directory, copy the `.env.pg.example` to `.env` and fill out the environment variable values.

e.g.
``` 
# MongoDB Settings
MONGO_USER=db-mm-api-test
MONGO_PASSWORD=<password>
MONGO_HOST=cluster0.sgml48b.mongodb.net
MONGO_PORT=27017
MONGO_DB=myFirstDatabse

# SQL Settings
SQL_CLIENT=postgres
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=strapi
DATABASE_PASSWORD=strapi
DATABASE_DATABASE=strapi
DATABASE_SCHEMA=public
```


Install all the dependencies by executing
```
$ npm install
```

Update column length to allow all data to migrate properly
```
psql>ALTER TABLE components_learning_objective_learning_objectives ALTER COLUMN objective TYPE VARCHAR(260);
```

#### Execute

Execute the migration script by running:
```
$ node index.js
```


### v3 Postgres to v4 Postgres

#### Setup
Change to the `feature/MATHMEDIC-114` branch in the `mathmedic-api` repo and run the following commands:

```
$ rm -rf node_modules package-lock.json
$ nvm use 18
$ npm i
```

##### Strapi Setup
Create a new user that is a super user.  This is needed so that the migration script can run in replica mode to ignore all foreign keys.
```
psql>CREATE ROLE my_admin WITH LOGIN SUPERUSER PASSWORD 'Temp1234';
```


Create a new database for the v4 tables.  In my environment I created a database called `strapiv4` database and make sure.
```
psql>CREATE DATABASE strapiv4 OWNER strapi;
```

Update `.env` file in Strapi with new database name and start the v4 Strapi against the Postgres database to get the tables generated properly. Once up and running you can kill the process so it isn't in the way.
```
$ yarn build && yarn develop
```

From the `v3-sql-v3-sql` directory, copy the `.env.pg.example` to `.env` and fill out the environment variable values.
```
# General Settings
DATABASE_CLIENT=pg
BATCH_SIZE=50

# V3 Settings
DATABASE_V3_HOST=127.0.0.1
DATABASE_V3_PORT=5432
DATABASE_V3_USER=my_admin
DATABASE_V3_PASSWORD=Temp1234
DATABASE_V3_DATABASE=strapi
DATABASE_V3_SCHEMA=public

# V4 Settings
DATABASE_V4_HOST=127.0.0.1
DATABASE_V4_PORT=5432
DATABASE_V4_USER=my_admin
DATABASE_V4_PASSWORD=Temp1234
DATABASE_V4_DATABASE=strapiv4
DATABASE_V4_SCHEMA=public

DISABLE_UP_MIGRATION=false
```

Install all the dependencies by executing
```
$ npm install
```

#### Execute

Execute the migration script by running:
```
$ node index.js
```

Once done - you can start Strapi back up and all data should exist.
