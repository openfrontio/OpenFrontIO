import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import HtmlWebpackPlugin from "html-webpack-plugin";
import webpack from "webpack";
import CopyPlugin from "copy-webpack-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkResourcesCopied(sourceDir, targetDir) {
  async function checkDir(source, target) {
    let items;
    try {
      items = await fs.readdir(source, { withFileTypes: true });
    } catch (error) {
      console.error(`Error reading directory ${source}:`, error);
      return false;
    }
    for (const item of items) {
      const sourcePath = path.join(source, item.name);
      const targetPath = path.join(target, item.name);
      if (item.isDirectory()) {
        try {
          await fs.access(targetPath);
        } catch (error) {
          // Target directory does not exist.
          return false;
        }
        const exists = await checkDir(sourcePath, targetPath);
        if (!exists) return false;
      } else if (item.isFile()) {
        try {
          await fs.access(targetPath);
        } catch (error) {
          // Target file does not exist.
          return false;
        }
      }
    }
    return true;
  }
  return checkDir(sourceDir, targetDir);
}
export default async (env, argv) => {
  const isProduction = argv.mode === "production";

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
          test: /\.(png|jpe?g|gif)$/i,
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
          isProduction ? "" : "localhost:3000",
        ),
      }),
      new webpack.DefinePlugin({
        "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
      }),
      ...(await (async () => {
        if (isProduction) {
          return [
            new CopyPlugin({
              patterns: [
                {
                  from: "resources",
                  to: ".",
                  noErrorOnMissing: true,
                },
              ],
              options: { concurrency: 100 },
            }),
          ];
        } else {
          const resourcesDir = path.resolve(__dirname, "resources");
          const targetDir = path.resolve(__dirname, "static");
          const allExist = await checkResourcesCopied(resourcesDir, targetDir);
          if (allExist) {
            console.log(
              "[CopyPlugin] Skipped: All resources already exist in static/.",
            );
            return []; // Skip CopyPlugin if all resources are present.
          } else {
            console.log(
              "[CopyPlugin] Copying missing resources to static/ ...",
            );
            return [
              new CopyPlugin({
                patterns: [
                  {
                    from: "resources",
                    to: ".",
                    noErrorOnMissing: true,
                  },
                ],
                options: { concurrency: 100 },
              }),
            ];
          }
        }
      })()),
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
              ],
              target: "http://localhost:3000",
              secure: false,
              changeOrigin: true,
            },
          ],
        },
  };
};
