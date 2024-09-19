const knex = require("knex");
require('dotenv').config();

let done = false;

const v3db = knex({
  client: 'postgres',
  connection: {
    connectionString: process.env.DATABASE_V3_URL,
    ssl: { "rejectUnauthorized": false }
  },
  debug: false,
});

const v4db = knex({
  client: 'postgres',
  connection: {
    connectionString: process.env.DATABASE_V4_URL,
    ssl: { "rejectUnauthorized": false }
  },
  debug: false,
});

async function migrate() {
  const ids = await v4db('questions').select('id')

  for(let id in ids) {
    const mongoObject = await v3db('id_map').select('mongoId').where({sqlId: id, collectionName: 'questions'})

    if(mongoObject && mongoObject[0] && mongoObject[0].mongoId) {
      console.log('updating', id, mongoObject[0].mongoId)
      await v4db('questions').where({id: id}).update({alternate_id: mongoObject[0].mongoId})
    }
  }
}

const intervalId = setInterval(() => {
  if (done === true) {
    console.log('clearing')
    clear();
  }
}, 1000);

function clear() {
  clearInterval(intervalId);
  console.log('done!')
  process.exit(0);
}

async function run() {
  try {
    console.log('starting')
    await migrate();
  } catch(e) {
    console.error('error', e);
  } finally {
    console.log('setting done to true')
    done = true
  }
}

run().catch(e => {console.error(e)})
