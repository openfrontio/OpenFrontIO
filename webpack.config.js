import { execSync } from "child_process";
import CopyPlugin from "copy-webpack-plugin";
import ESLintPlugin from "eslint-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import webpack from "webpack";

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    const networkInterface = interfaces[interfaceName];
    if (!networkInterface) continue;
    for (const address of networkInterface) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return "localhost";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const gitCommit =
  process.env.GIT_COMMIT ?? execSync("git rev-parse HEAD").toString().trim();

export default async (env, argv) => {
  const isProduction = argv.mode === "production";

  const appBaseUrl = process.env.CAPACITOR_BUILD
    ? isProduction && process.env.CAPACITOR_PRODUCTION_HOSTNAME
      ? `https://${process.env.CAPACITOR_PRODUCTION_HOSTNAME}`
      : `http://${getLocalIP()}:9000`
    : "";
  const apiBaseForLocalhost = `http://${process.env.CAPACITOR_BUILD ? getLocalIP() : "localhost"}:8787`;

  return {
    entry: "./src/client/Main.ts",
    output: {
      publicPath: "/",
      filename: "js/[name].[contenthash].js", // Added content hash
      path: path.resolve(__dirname, "static"),
      clean: isProduction,
    },
    module: {
      rules: [
        {
          test: /\.bin$/,
          type: "asset/resource", // Changed from raw-loader
          generator: {
            filename: "binary/[name].[contenthash][ext]", // Added content hash
          },
        },
        {
          test: /\.txt$/,
          type: "asset/source",
        },
        {
          test: /\.md$/,
          type: "asset/resource", // Changed from raw-loader
          generator: {
            filename: "text/[name].[contenthash][ext]", // Added content hash
          },
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
          test: /\.(webp|png|jpe?g|gif)$/i,
          type: "asset/resource",
          generator: {
            filename: "images/[name].[contenthash][ext]", // Added content hash
          },
        },
        {
          test: /\.html$/,
          use: ["html-loader"],
        },
        {
          test: /\.svg$/,
          type: "asset/resource", // Changed from asset/inline for caching
          generator: {
            filename: "images/[name].[contenthash][ext]", // Added content hash
          },
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/,
          type: "asset/resource", // Changed from file-loader
          generator: {
            filename: "fonts/[name].[contenthash][ext]", // Added content hash and fixed path
          },
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
        // Add optimization for HTML
        minify: isProduction
          ? {
              collapseWhitespace: true,
              removeComments: true,
              removeRedundantAttributes: true,
              removeScriptTypeAttributes: true,
              removeStyleLinkTypeAttributes: true,
              useShortDoctype: true,
            }
          : false,
      }),
      new webpack.DefinePlugin({
        "process.env.WEBSOCKET_URL": JSON.stringify(
          appBaseUrl ? appBaseUrl.split("://")[1] : "", // remove protocol
        ),
        "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
        "process.env.GIT_COMMIT": JSON.stringify(gitCommit),
        "process.env.APP_BASE_URL": JSON.stringify(appBaseUrl),
        "process.env.LOCAL_API_BASE_URL": JSON.stringify(apiBaseForLocalhost),
        "process.env.CAPACITOR_PRODUCTION_HOSTNAME": JSON.stringify(
          process.env.CAPACITOR_PRODUCTION_HOSTNAME,
        ),
      }),
      new CopyPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, "resources"),
            to: path.resolve(__dirname, "static"),
            noErrorOnMissing: true,
          },
          {
            from: path.resolve(
              __dirname,
              "node_modules/@capacitor/android/capacitor.js",
            ),
            to: path.resolve(__dirname, "static/capacitor.js"),
            noErrorOnMissing: true,
          },
        ],
        options: { concurrency: 100 },
      }),
      new ESLintPlugin({
        context: __dirname,
      }),
    ],
    optimization: {
      // Add optimization configuration for better caching
      runtimeChunk: "single",
      splitChunks: {
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: "vendors",
            chunks: "all",
          },
        },
      },
    },
    devServer: isProduction
      ? {}
      : {
          devMiddleware: { writeToDisk: true },
          static: {
            directory: path.join(__dirname, "static"),
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
                "/api/env",
                "/api/game",
                "/api/public_lobbies",
                "/api/join_game",
                "/api/start_game",
                "/api/create_game",
                "/api/archive_singleplayer_game",
                "/api/auth/callback",
                "/api/auth/discord",
                "/api/kick_player",
              ],
              target: "http://localhost:3000",
              secure: false,
              changeOrigin: true,
            },
          ],
        },
  };
};
