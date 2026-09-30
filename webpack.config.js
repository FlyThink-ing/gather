const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  const localEnvPath = path.resolve(__dirname, '.env.local');
  const dotenvPath = process.env.DOTENV_CONFIG_PATH
    ? path.resolve(__dirname, process.env.DOTENV_CONFIG_PATH)
    : process.env.LOCAL_SUPABASE === '1' && fs.existsSync(localEnvPath)
      ? localEnvPath
      : undefined;
  return {
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProd ? '[name].[contenthash].js' : '[name].js',
      publicPath: '/',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.jsx', '.js'],
      modules: [path.resolve(__dirname, 'src'), 'node_modules'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader'],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: './public/index.html' }),
      new Dotenv({ path: dotenvPath, systemvars: true, silent: true }),
    ],
    devServer: {
      static: path.resolve(__dirname, 'public'),
      historyApiFallback: true,
      port: 3000,
      hot: true,
      open: true,
    },
    devtool: isProd ? 'source-map' : 'eval-source-map',
  };
};
