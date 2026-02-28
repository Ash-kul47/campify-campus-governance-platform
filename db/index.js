require("dotenv").config(); // FIRST line
//reads the .env file to get db data
const { Pool } = require("pg");//pg-library for postgres
//pool-conncetion manager

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

pool.connect()//try to conncet now
  .then(() => console.log("PostgreSQL connected ✅"))
  .catch(err => console.error("PostgreSQL connection error ❌", err));

module.exports = pool;//Allow other files to use this database connection.
