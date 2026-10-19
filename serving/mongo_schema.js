// Create or update the FinSight serving collections, validators and indexes.
//
//   MONGO_DATABASE=finsight mongosh "$MONGO_URI" serving/mongo_schema.js
//
// Definitions come from serving/mongo_schema.json, which serving/mongo_setup.py
// (and the tests) apply as well. Safe to re-run.

const fs = require("fs");
const path = require("path");

const schemaFile = process.env.FINSIGHT_SCHEMA_FILE || path.join(__dirname, "mongo_schema.json");
const collections = JSON.parse(fs.readFileSync(schemaFile, "utf8")).collections;
const target = db.getSiblingDB(process.env.MONGO_DATABASE || "finsight");
const existing = new Set(target.getCollectionNames());

for (const [name, spec] of Object.entries(collections)) {
  const options = spec.validator
    ? { validator: spec.validator, validationLevel: "moderate", validationAction: "error" }
    : {};
  if (!existing.has(name)) {
    target.createCollection(name, options);
  } else if (spec.validator) {
    target.runCommand({ collMod: name, ...options });
  }
  for (const index of spec.indexes || []) {
    target[name].createIndex(index.keys, { name: index.name, unique: Boolean(index.unique) });
  }
  print(`ok ${target.getName()}.${name}`);
}
