import CopyPlugin from "copy-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import path from "path";
import { fileURLToPath } from "url";
import webpack from "webpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default (env, argv) => {
  const isProduction = argv.mode === "production";

  return {
    entry: "./src/client/Main.ts",
    output: {
      publicPath: "/",
      filename: "bundle.js",
      path: path.resolve(__dirname, "out"),
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.bin$/,
          use: "raw-loader",
        },
        {
          test: /\.txt$/,
          use: "raw-loader",
        },
        {
          test: /\.ts$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            "style-loader",
            {
              loader: "css-loader",
              options: {
                importLoaders: 1,
              },
            },
            {
              loader: "postcss-loader",
              options: {
                postcssOptions: {
                  plugins: ["tailwindcss", "autoprefixer"],
                },
              },
            },
          ],
        },
        {
          test: /\.(png|jpe?g|gif)$/i,
          type: "asset/resource",
          generator: {
            filename: "images/[hash][ext][query]",
          },
        },
        {
          test: /\.html$/,
          use: ["html-loader"],
        },
        {
          test: /\.svg$/,
          type: "asset/inline",
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/,
          use: [
            {
              loader: "file-loader",
              options: {
                name: "[name].[ext]",
                outputPath: "fonts/",
                publicPath: "../fonts/", // This is important
              },
            },
          ],
        },
      ],
    },
    resolve: {
      extensions: [".tsx", ".ts", ".js"],
      alias: {
        "protobufjs/minimal": path.resolve(
          __dirname,
          "node_modules/protobufjs/minimal.js",
        ),
      },
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: "./src/client/index.html",
        filename: "index.html",
      }),
      new webpack.DefinePlugin({
        "process.env.WEBSOCKET_URL": JSON.stringify(
          isProduction ? "" : "localhost:3000",
        ),
      }),
      new webpack.DefinePlugin({
        "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
      }),
      new CopyPlugin({
        patterns: [{ from: "resources", to: path.resolve(__dirname, "out") }],
        options: {
          concurrency: 100,
        },
      }),
    ],
    devServer: isProduction
      ? {}
      : {
          devMiddleware: { writeToDisk: true },
          static: {
            directory: path.join(__dirname, "out"),
          },
          historyApiFallback: true,
          compress: true,
          port: 9000,
          proxy: [
            // WebSocket proxies
            {
              context: ["/socket"],
              target: "ws://localhost:3000",
              ws: true,
              changeOrigin: true,
              logLevel: "debug",
            },
            // Worker WebSocket proxies - using direct paths without /socket suffix
            {
              context: ["/w0"],
              target: "ws://localhost:3001",
              ws: true,
              secure: false,
              changeOrigin: true,
              logLevel: "debug",
            },
            {
              context: ["/w1"],
              target: "ws://localhost:3002",
              ws: true,
              secure: false,
              changeOrigin: true,
              logLevel: "debug",
            },
            {
              context: ["/w2"],
              target: "ws://localhost:3003",
              ws: true,
              secure: false,
              changeOrigin: true,
              logLevel: "debug",
            },
            // Worker proxies for HTTP requests
            {
              context: ["/w0"],
              target: "http://localhost:3001",
              pathRewrite: { "^/w0": "" },
              secure: false,
              changeOrigin: true,
              logLevel: "debug",
            },
            {
              context: ["/w1"],
              target: "http://localhost:3002",
              pathRewrite: { "^/w1": "" },
              secure: false,
              changeOrigin: true,
              logLevel: "debug",
            },
            {
              context: ["/w2"],
              target: "http://localhost:3003",
              pathRewrite: { "^/w2": "" },
              secure: false,
              changeOrigin: true,
              logLevel: "debug",
            },
            // Original API endpoints
            {
              context: [
                "/public_lobbies",
                "/join_game",
                "/start_game",
                "/create_game",
                "/archive_singleplayer_game",
                "/debug-ip",
                "/auth/callback",
                "/auth/discord",
              ],
              target: "http://localhost:3000",
              secure: false,
              changeOrigin: true,
            },
          ],
        },
  };
};
