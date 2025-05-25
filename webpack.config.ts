import path from 'path';
import webpack from 'webpack';
import CopyPlugin from 'copy-webpack-plugin';

const config: webpack.Configuration = {
  // ... existing config ...
  resolve: {
    alias: {
      'onnxruntime-web': path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.all.bundle.min.js'),
    },
    extensions: ['.tsx', '.ts', '.js'],
  },
  plugins: [
    // ... existing plugins ...
    new CopyPlugin({
      patterns: [
        {
          from: 'node_modules/onnxruntime-web/dist/*.wasm',
          to: '[name][ext]',
        },
      ],
    }),
  ],
}; 