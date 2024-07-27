const express = require('express');
const { initializeDatabase } = require('./database');
const routes = require('./routes');
const { port } = require('./config');
const {logError} = require("../lib/errorHandling");

const app = express();
app.use(express.json());
app.use(express.static('public'));

async function startServer() {
  try {
    await initializeDatabase();

    app.use('/', routes);

    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  } catch (error) {
    await logError(error);
  }
}

startServer().catch(console.error);
