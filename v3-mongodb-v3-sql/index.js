require('dotenv').config();

const logger = require('./logger');
const _ = require('lodash');
const pluralize = require('pluralize');
const { singular } = pluralize;

const knex = require('./knex');
const schemaInspector = require('knex-schema-inspector').default;
const inspector = schemaInspector(knex);
const mongo = require('./mongo');
const { transformEntry } = require('./transform');
const idMap = require('./id-map');

const getGlobalId = (model, modelName, prefix) => {
  let globalId = prefix ? `${prefix}-${modelName}` : modelName;

  return model.globalId || _.upperFirst(_.camelCase(globalId));
};

const getCollectionName = (associationA, associationB) => {
  if (associationA.dominant && _.has(associationA, 'collectionName')) {
    return associationA.collectionName;
  }

  if (associationB.dominant && _.has(associationB, 'collectionName')) {
    return associationB.collectionName;
  }

  return [associationA, associationB]
    .sort((a, b) => {
      if (a.collection === b.collection) {
        if (a.dominant) return 1;
        else return -1;
      }
      return a.collection < b.collection ? -1 : 1;
    })
    .map((table) => {
      return _.snakeCase(`${pluralize.plural(table.collection)}_${pluralize.plural(table.via)}`);
    })
    .join('__');
};

async function getModelDefs(db) {
  const coreStore = db.collection('core_store');

  const cursor = coreStore.find({
    key: { $regex: /^model_def/ },
  });

  const res = (await cursor.toArray())
    .map((item) => JSON.parse(item.value))
    .map((model) => {
      const { uid } = model;

      if (!model.uid.includes('::')) {
        return {
          ...model,
          modelName: uid.split('.')[1],
          globalId: _.upperFirst(_.camelCase(`component_${uid}`)),
        };
      }

      let plugin;
      let apiName;
      let modelName;

      if (uid.startsWith('strapi::')) {
        plugin = 'admin';
        modelName = uid.split('::')[1];
      } else if (uid.startsWith('plugins')) {
        plugin = uid.split('::')[1].split('.')[0];
        modelName = uid.split('::')[1].split('.')[1];
      } else if (uid.startsWith('application')) {
        apiName = uid.split('::')[1].split('.')[0];
        modelName = uid.split('::')[1].split('.')[1];
      }

      return {
        ...model,
        plugin,
        apiName,
        modelName,
        globalId: getGlobalId(model, modelName, plugin),
      };
    });

  await cursor.close();

  return res;
}

async function run() {
  try {
    logger.info("Connecting to MongoDB...")
    await mongo.connect();

    const db = mongo.db();
    logger.info("Connected! Fetching model definitions...")

    knex.schema.alterTable('components_learning_objective_learning_objectives', function(table) {
      table.string('objective', 260);
    });

    await knex.raw('drop table if exists id_map');

    const models = await getModelDefs(db);

    const modelMap = models.reduce((acc, model) => {
      acc[model.uid] = model;
      return acc;
    }, {});

    logger.info("Models fetched successfully. Executing pre-migration steps...")
    const dialect = require(`./dialects/${knex.client.config.client}`)(knex, inspector);
    await dialect.delAllTables(knex);
    await dialect.beforeMigration?.(knex);
    logger.info("Pre-migration steps complete")

    // 1st pass: for each document create a new row and store id in a map
    logger.info("First Pass - Creating rows and mapping IDs to indexes...")
    for (const model of models) {
      const cursor = db.collection(model.collectionName).find();
      logger.verbose(`Processing collection ${model.collectionName}`)

      if (! await knex.schema.hasTable(model.collectionName)) {
        logger.verbose(`table ${model.collectionName} does not exist in postgres - skipping`);
        continue;
      }

      while (await cursor.hasNext()) {
        const entry = await cursor.next();
        const row = transformEntry(entry, model);

        row.id = idMap.next(entry._id, model.collectionName);

        await knex(model.collectionName).insert(row);
      }

      await cursor.close();
    }

    logger.info("Second Pass - Rows created and IDs mapped. Linking components & relations with tables...")
    // 2nd pass: for each document's components & relations create the links in the right tables

    for (const model of models) {
      const cursor = db.collection(model.collectionName).find();
      logger.verbose(`Processing collection ${model.collectionName}`)

      if (! await knex.schema.hasTable(model.collectionName)) {
        logger.verbose(`table ${model.collectionName} does not exist in postgres - skipping`);
        continue;
      }

      while (await cursor.hasNext()) {
        const entry = await cursor.next();

        for (const key of Object.keys(entry)) {
          try {
            const attribute = model.attributes[key];

            if (!attribute) {
              continue;
            }

            if (attribute.type === 'component') {
              // create compo links
              const componentModel = modelMap[attribute.component];
              const linkTableName = `${model.collectionName}_components`;

              const rows = entry[key].map((mongoLink, idx) => {
                return {
                  id: idMap.next(mongoLink._id, linkTableName),
                  field: key,
                  order: idx + 1,
                  component_type: componentModel.collectionName,
                  component_id: idMap.get(mongoLink.ref),
                  [`${singular(model.collectionName)}_id`]: idMap.get(entry._id),
                };
              });

              if (rows.length > 0) {
                logger.debug(`Filling component ${key} joining table - ${JSON.stringify(rows)}`)
                await knex(linkTableName).insert(rows);
              }

              continue;
            }

            if (attribute.type === 'dynamiczone') {

              // create compo links
              const linkTableName = `${model.collectionName}_components`;

              const rows = entry[key].map((mongoLink, idx) => {
                const componentModel = models.find((m) => m.globalId === mongoLink.kind);

                return {
                  id: idMap.next(mongoLink._id, linkTableName),
                  field: key,
                  order: idx + 1,
                  component_type: componentModel.collectionName,
                  component_id: idMap.get(mongoLink.ref),
                  [`${singular(model.collectionName)}_id`]: idMap.get(entry._id),
                };
              });

              if (rows.length > 0) {
                logger.debug(`Filling dynamiczone ${key} joining table - ${JSON.stringify(rows)}`)
                await knex(linkTableName).insert(rows);
              }

              continue;
            }

            if (attribute.model === 'file' && attribute.plugin === 'upload') {
              if (!entry[key]) {
                continue;
              }

              const row = {
                upload_file_id: idMap.get(entry[key]),
                related_id: idMap.get(entry._id),
                related_type: model.collectionName,
                field: key,
                order: 1,
              };
              logger.debug(`Linking single file - ${key} - ${JSON.stringify(row)}`)
              await knex('upload_file_morph').insert(row);
            }

            if (attribute.collection === 'file' && attribute.plugin === 'upload') {
              const rows = entry[key].map((e, idx) => ({
                upload_file_id: idMap.get(e),
                related_id: idMap.get(entry._id),
                related_type: model.collectionName,
                field: key,
                order: idx + 1,
              }));

              if (rows.length > 0) {
                logger.debug(`Linking multiple files - ${key} - ${JSON.stringify(rows)}`)
                await knex('upload_file_morph').insert(rows);
              }
            }

            if (attribute.model || attribute.collection) {
              // create relation links

              const targetModel = models.find((m) => {
                return (
                  [attribute.model, attribute.collection].includes(m.modelName) &&
                  (!attribute.plugin || (attribute.plugin && attribute.plugin === m.plugin))
                );
              });

              const targetAttribute = targetModel?.attributes?.[attribute.via];

              const isOneWay = attribute.model && !attribute.via && attribute.model !== '*';
              const isOneToOne =
                attribute.model &&
                attribute.via &&
                targetAttribute?.model &&
                targetAttribute?.model !== '*';
              const isManyToOne =
                attribute.model &&
                attribute.via &&
                targetAttribute?.collection &&
                targetAttribute?.collection !== '*';
              const isOneToMany =
                attribute.collection &&
                attribute.via &&
                targetAttribute?.model &&
                targetAttribute?.model !== '*';
              const isManyWay =
                attribute.collection && !attribute.via && attribute.collection !== '*';
              const isMorph = attribute.model === '*' || attribute.collection === '*';

              // TODO: check dominant side
              const isManyToMany =
                attribute.collection &&
                attribute.via &&
                targetAttribute?.collection &&
                targetAttribute?.collection !== '*';


              if (isOneWay || isOneToOne || isManyToOne) {
                // TODO: optimize with one updata at the end

                if (!entry[key] || !idMap.get(entry[key])) {
                  continue;
                }

                try {
                  await knex(model.collectionName)
                    .update({
                      [key]: idMap.get(entry[key]),
                    })
                    .where('id', idMap.get(entry._id));
                } catch (err) {
                  if (err.routine === '_bt_check_unique') {
                    logger.warn(err)
                  } else {
                    throw err;
                  }
                }

                continue;
              }

              if (isOneToMany) {
                // nothing to do
                continue;
              }

              if (isManyWay) {
                const joinTableName =
                  attribute.collectionName || `${model.collectionName}__${_.snakeCase(key)}`;

                const fk = `${singular(model.collectionName)}_id`;
                let otherFk = `${singular(attribute.collection)}_id`;

                if (otherFk === fk) {
                  otherFk = `related_${otherFk}`;
                }

                const rows = entry[key].map((id) => {
                  return {
                    [otherFk]: idMap.get(id),
                    [fk]: idMap.get(entry._id),
                  };
                });

                if (rows.length > 0) {
                  await knex(joinTableName).insert(rows);
                }

                continue;
              }

              if (isManyToMany) {
                if (attribute.dominant) {
                  const joinTableName = getCollectionName(attribute, targetAttribute);

                  let fk = `${singular(targetAttribute.collection)}_id`;
                  let otherFk = `${singular(attribute.collection)}_id`;

                  if (otherFk === fk) {
                    fk = `${singular(attribute.via)}_id`;
                  }

                  const rows = entry[key].map((id) => {
                    return {
                      [otherFk]: idMap.get(id),
                      [fk]: idMap.get(entry._id),
                    };
                  });

                  if (rows.length > 0) {
                    await knex(joinTableName).insert(rows);
                  }
                }

                continue;
              }

              continue;
            }

            // get relations
          } catch(err) {
            throw err;
          }
        }
      }

      await cursor.close();

      await dialect.afterMigration?.(knex);

    }
    logger.info("Post-migration steps complete.")

    logger.info("Saving id map to database");
    await knex.schema.createTableIfNotExists('id_map', function(table) {
      table.string('mongoId');
      table.string('collectionName');
      table.integer('sqlId', 10);
    });

    const inserts = [];
    for (const [mongoId, info] of idMap.myCollectionGlobalMap().entries()) {
      inserts.push({collectionName: info.collectionName, mongoId, sqlId: info.id});
    }

    await knex.batchInsert('id_map', inserts, 30);
    logger.info('Done!');
  }
  catch(err){
    console.log(err);
    logger.error(err)
  }
  finally {
    logger.info("Cleaning Up...")
    await mongo.close();
    await knex.destroy();
  }
  logger.info('Migration Complete');
}

run()
