import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Client, Events, GatewayIntentBits } from "discord.js";

export class DiscordBot {
  private client: Client;
  private secretManager: SecretManagerServiceClient;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.secretManager = new SecretManagerServiceClient();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (c) => {
      console.log(`Ready! Logged in as ${c.user.tag}`);
    });

    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;

      if (message.content === "!ping") {
        await message.reply("Pong! 🏓");
      }

      if (message.content === "!hello") {
        await message.reply(`Hello ${message.author.username}! 👋`);
      }
    });
  }

  private async getToken(): Promise<string | undefined> {
    const name =
      "projects/openfrontio/secrets/discord-bot-token/versions/latest";
    const [version] = await this.secretManager.accessSecretVersion({ name });
    return version.payload?.data?.toString().trim();
  }

  public async start(): Promise<void> {
    try {
      const token = await this.getToken();
      if (!token) {
        throw new Error("Failed to retrieve Discord token");
      }
      await this.client.login(token);
    } catch (error) {
      console.error("Failed to start bot:", error);
      throw error;
    }
  }

  public stop(): void {
    this.client.destroy();
  }
}
