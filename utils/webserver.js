// Do this as the first thing so that any code reading it knows the right env.
process.env.NODE_ENV = 'development';
process.env.ASSET_PATH = '/';

var express = require('express'),
  webpack = require('webpack'),
  webpackDevMiddleware = require('webpack-dev-middleware'),
  webpackHotMiddleware = require('webpack-hot-middleware'),
  config = require('../webpack.config'),
  path = require('path'),
  PORT = process.env.PORT || 3000;

var options = config.chromeExtensionBoilerplate || {};
var excludeEntriesToHotReload = options.notHotReload || [];

for (var entryName in config.entry) {
  if (excludeEntriesToHotReload.indexOf(entryName) === -1) {
    config.entry[entryName] = [
      'webpack-hot-middleware/client?path=/__webpack_hmr&timeout=20000&reload=true',
    ].concat(config.entry[entryName]);
  }
}

config.plugins = [new webpack.HotModuleReplacementPlugin()].concat(
  config.plugins || []
);

delete config.chromeExtensionBoilerplate;

var compiler = webpack(config);
var app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.use(
  webpackDevMiddleware(compiler, {
    publicPath: config.output.publicPath,
    writeToDisk: true,
  })
);
app.use(webpackHotMiddleware(compiler, { path: '/__webpack_hmr' }));
app.use(express.static(path.join(__dirname, '../build')));

app.listen(PORT, 'localhost', () => {
  console.log(`Development server listening at http://localhost:${PORT}`);
});
