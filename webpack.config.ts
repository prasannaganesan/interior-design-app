import webpack from 'webpack';
import CopyPlugin from 'copy-webpack-plugin';

const config: webpack.Configuration = {
  // ... existing config ...
  resolve: {
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

export default config;
