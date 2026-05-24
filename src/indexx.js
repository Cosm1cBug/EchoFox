console.clear();
const CFonts = require('cfonts');
const {say} = CFonts;
const fs = require('fs');
const express = require('express');
const path = require('path');
const cluster = require('cluster');
const db = require('./lib/Functions/sqliteDB');
const app = express();
const port = process.env.PORT || 3000;  // Move to config.js

say(`EchoFox`, {
  font: 'shade',
  align: 'center',
  gradient: ['#12c2e9', '#c471ed'],
  transitionGradient: true,
  letterSpacing: 3
});
say(`Made with 💖 By COSMICBUG`, {
	font: 'tiny',
	align: 'center',
	gradient: ['#DCE35B', '#45B649'],
	transitionGradient: true,
  letterSpacing: 2
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

function start(file) {
  let args = [path.join(__dirname, file), ...process.argv.slice(2)]

  cluster.setupMaster({
    exec: path.join(__dirname, file),
    args: args.slice(1),
  });

  let p = cluster.fork();

  p.on('message', (data) => {
    console.log('[RECEIVED]', data);
    switch (data) {
        case 'reset':
            p.kill();
            start(file);
            break;
        case 'uptime':
            p.send(process.uptime());
        break;
    }
  });

  p.on('exit', (code) => {
    console.error('Exited with code:', code);
    if (code !== 0) {
      console.log('Restarting...');
      start(file);
    }
  });
}

process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.closeConnection();
  console.log('Exiting...');
  process.exit(0);
});

start('index.js');