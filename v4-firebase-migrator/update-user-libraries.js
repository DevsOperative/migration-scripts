const knex = require("knex");
const dotenv = require('dotenv').config();
const readline = require('readline');
const { stdin: input, stdout: output } = require('node:process');

let offset = 0;
let limit = 10000;
if (process.argv[2]) {
  offset = process.argv[2];
}

if (process.argv[3]) {
  limit = process.argv[3];
}

const dryRun = true;
const rl = readline.createInterface({ input, output });

console.log("************************************************************************");
console.log("                         dryRun = " + dryRun);
console.log("                         offset = " + offset);
console.log("                         limit = " + limit);
if (!dryRun) {
  console.log("                        THIS IS LIVE PEOPLE!! ");
}
console.log("************************************************************************");

if (!dryRun) {
  rl.question("Hit ENTER to proceed", (answer) => {
    rl.close();
  })
}

const additionalConfigV3 = {
  useNullAsDefault: true,
  connection: {
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_DATABASE,
  },
};

const db = knex({
  client: process.env.DATABASE_CLIENT,
  ...additionalConfigV3,
});

const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID, private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url:
    process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  }),
});

let done = false;

async function run() {
  try {
    await updateUserLibraries();
  } catch (e) {
    console.error(e);
  } finally {
    done = true;
  }
}

async function updateUserLibraries() {
  const total = (
    await db
      .count('sqlId', {as: 'total'})
      .from('id_map')
      .where('collectionName', 'users-permissions_user')
  )[0].total;

  const userIdMaps = await db
    .select(['mongoId', 'sqlId'])
    .rowNumber('rowNum', function() {
      this.orderBy('sqlId')
    })
    .from('id_map')
    .where('collectionName', 'users-permissions_user')
    .offset(offset)
    .limit(limit)

  for (const userIdMap of userIdMaps) {
    console.log(`updating user (${userIdMap.sqlId} - ${userIdMap.mongoId}) library ${userIdMap.rownum} of ${total}`);
    const q = await admin.firestore()
      .collection('users')
      .doc(userIdMap.mongoId)
      .collection('library')
      .where('updatedAt', '>', new Date('2023-11-11T08:00:00-04:00'))
      .get();

    const documents = q.docs.map(d => ({...d.data(), id: d.id}));

    let batch = admin.firestore().batch();
    let count = 0;
    for (const doc of documents) {
      count++;
      const libCollection = admin.firestore()
        .collection('users')
        .doc(userIdMap.sqlId.toString())
        .collection('library');
      const a = await libCollection.doc(doc.id).get();

      if (a.exists) {
        const data = {
          ...a.data(),
          id: a.id
        };

        if (data.updatedAt > doc.updatedAt) {
          console.log(`\tupdating document ${doc.id} from the old user id document`);
          if (!dryRun) {
            batch.set(libCollection.doc(doc.id), data);
          }
        }
      } else {
        console.log(`\tcreating new document ${doc.id} from the old user id document`);
        if (!dryRun) {
          batch.set(libCollection.doc(doc.id), doc);
        }
      }

      if (count > 50) {
        await batch.commit();
        batch = admin.firestore().batch();
        count = 0;
      }
    }
    await batch.commit();
  }
}

const intervalId = setInterval(() => {
  if (done) {
    clear();
  }
}, 1000);

if (!dryRun) {
  rl.on('close', () => {
    run().catch(error => console.error(error));
  })
} else {
  run().catch(error => console.error(error));
}

function clear() {
  clearInterval(intervalId);
  console.log('done!')
  process.exit(0);
}
