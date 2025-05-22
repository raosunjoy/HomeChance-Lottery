const webpack = require('webpack');

module.exports = function override(config) {
  // Provide polyfills for Node.js core modules
  config.resolve.fallback = {
    ...config.resolve.fallback,
    buffer: require.resolve('buffer/'),
  };

  // Provide the Buffer global
  config.plugins = [
    ...config.plugins,
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
  ];

// Ignore source map warnings for specific packages
  config.ignoreWarnings = [
    {
      module: /@solana\/buffer-layout/,
      message: /Failed to parse source map/,
    },
    {
      module: /superstruct/,
      message: /Failed to parse source map/,
    },
  ];

  return config;
};


