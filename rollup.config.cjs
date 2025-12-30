const resolve = require('@rollup/plugin-node-resolve').default;
const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');

module.exports = {
  input: 'src/index.js',
  output: {
    file: 'dist/walletConnectProvider.umd.js',
    format: 'umd',
    name: 'MultiversXWalletConnectProvider'
  },
  plugins: [
    resolve({
      browser: true,      // force résolution modules pour navigateur
      preferBuiltins: false
    }),
    commonjs(),            // convert CommonJS -> ES
    json()                 // permet d’importer les JSON
  ]
};
