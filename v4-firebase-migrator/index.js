const knex = require("knex");
const dotenv = require('dotenv').config();

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
    // console.log("adding libraries with new ids and copying documents");
    // await loadLibraries();

    console.log("adding users with new ids and copying library documents, shared documents, and assigned-links");
    await loadUsers();
  } catch (e) {
    console.error(e);
  } finally {
    done = true;
  }
}

async function loadLibraries() {
  const results = await db
    .select()
    .from('id_map')
    .where('collectionName', 'libraries')
    .limit(10);

  await Promise.all(
    await results.map(
      async lib => {
        const strapiLibrary = await (await fetch(process.env.API_URL + '/api/libraries/' + lib.sqlId.toString() + '?populate[logo][populate]=*&populate[logo_icon][populate]=*&populate[courses][populate][courseLogo][populate]=*', {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDUwNjksImlhdCI6MTY5OTcyNDkwMiwiZXhwIjoxNzAyMzE2OTAyfQ.qAvNU439RxcQapUII_2c2c8XXBusXMIa_yoFNR5j5PQ'
          },
        })).json();

        await admin.firestore()
          .collection('libraries')
          .doc(lib.sqlId.toString())
          .set({
              id: lib.sqlId.toString(),
              ...strapiLibrary.data.attributes
            }
          );

        return handleBatch(
          admin.firestore().collection('libraries').doc(lib.mongoId).collection('documents'),
          admin.firestore().collection('libraries').doc(lib.sqlId.toString()).collection('documents'),
          (data) => {
            if (data.ownerId) {
              data.ownerId = lib.sqlId.toString();
            }

            return data;
          }
        );
      }
    )
  );
}

async function loadUsers() {
  const count = (await db.from('id_map').count('mongoId'))[0].count;
  let start = 9999;
  let pageSize = 100;

  while (start < count) {
    console.log("Creating users from " + start + " to " + (pageSize + start));
    const results = await db
      .select()
      .from('id_map')
      .where('collectionName', 'users-permissions_user')
      .offset(start)
      .limit(pageSize);

    for (const res of results) {
      const docRef = await admin.firestore()
        .collection('users')
        .doc(res.mongoId)
        .get();

      const user = docRef.data();
      if (user) {
        await admin.firestore()
          .collection('users')
          .doc(res.sqlId.toString())
          .set({
              ...user,
              id: res.sqlId.toString()
            }, {merge: true}
          );

        await handleBatch(
          admin.firestore().collection('users').doc(res.mongoId).collection('library'),
          admin.firestore().collection('users').doc(res.sqlId.toString()).collection('library'),
          (data) => {
            if (data.ownerId) {
              data.ownerId = res.sqlId.toString();
            }
            return data;
          }
        );

        await Promise.all([
          handleBatch(
            admin.firestore().collection('shared').where('originalOwnerId', '==', res.mongoId),
            admin.firestore().collection('shared'),
            (data) => ({originalOwnerId: res.sqlId.toString(), ...data})
          ),

          handleBatch(
            admin.firestore().collection('shared').where('originalOwnerId', '==', res.mongoId),
            admin.firestore().collection('shared'),
            (data) => ({originalOwnerId: res.sqlId.toString(), ...data})
          ),

          handleBatch(
            admin.firestore().collection('shared').where('users', 'array-contains', res.mongoId),
            admin.firestore().collection('shared'),
            (data) => {
              data.users[data.users.indexOf(res.mongoId)] = res.sqlId.toString();
              data.usersData = data.usersData
                .filter(a => a.id === res.mongoId)
                .map(a => ({
                      id: res.sqlId.toString(),
                      ...a
                    }
                  )
                );
              return data;
            }
          )
        ]);

        await handleBatch(
          admin.firestore().collection('assigned-links').where('ownerId', '==', res.mongoId),
          admin.firestore().collection('assigned-links'),
          (data) => ({ownerId: res.sqlId.toString(), ...data})
        );
      }
    }

    start = start + pageSize + 1;
  }
}

async function handleBatch(query, updateCollection, adjustPayload) {
  let batch = admin.firestore().batch();
  let count = 0;

  const queryResults = await query.get();

  process.stdout.write("Processing " + count + " of " + queryResults.docs.length + "\r");
  let docs = queryResults.docs;

  for (const max of [100, 50]) {
    let worked = false;
    try {
      for (const data of docs) {
        count++;
        batch.set(updateCollection.doc(data.id), adjustPayload(data.data()));

        if (count > max) {
          await batch.commit();
          batch = admin.firestore().batch();
          count = 0;
        }
      }

      worked = true;
    } catch(error) {
      console.error(error);
      batch = admin.firestore().batch();
      count = 0;
    }

    if (worked) {
      break;
    }
  }

  return batch.commit();
}

const intervalId = setInterval(() => {
  if (done) {
    clear();
  }
}, 1000);

run().catch(error => console.error(error));

function clear() {
  clearInterval(intervalId);
  console.log('done!')
  process.exit(0);
}
