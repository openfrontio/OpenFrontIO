import { DonateGoldExecution } from "../src/core/execution/DonateGoldExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import {
  DONATION_BROKE_GOLD_THRESHOLD,
  DONATION_INDEX_GOLD_RECV,
  DONATION_INDEX_GOLD_RECV_BROKE,
  GOLD_INDEX_DONATE_RECV,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

let game: Game;
let donor: Player;
let recipient: Player;

const donorInfo = new PlayerInfo("donor", PlayerType.Human, "donor", "donor");
const recipientInfo = new PlayerInfo(
  "recipient",
  PlayerType.Human,
  "recipient",
  "recipient",
);

function donations(player: Player): readonly bigint[] | undefined {
  return game.stats().getPlayerStats(player)?.donations;
}

function received(player: Player): bigint {
  return donations(player)?.[DONATION_INDEX_GOLD_RECV] ?? 0n;
}

function receivedBroke(player: Player): bigint {
  return donations(player)?.[DONATION_INDEX_GOLD_RECV_BROKE] ?? 0n;
}

function donatedGold(player: Player): bigint {
  return (
    game.stats().getPlayerStats(player)?.gold?.[GOLD_INDEX_DONATE_RECV] ?? 0n
  );
}

describe("GoldDonationStats", () => {
  beforeEach(async () => {
    game = await setup("plains", { donateGold: true }, [
      donorInfo,
      recipientInfo,
    ]);
    donor = game.player("donor");
    recipient = game.player("recipient");
    donor.conquer(game.ref(10, 10));
    recipient.conquer(game.ref(50, 50));
    donor.addGold(10_000_000n);
  });

  test("a donation to a broke recipient counts as both received and broke", () => {
    expect(recipient.gold()).toBe(0n);

    expect(donor.donateGold(recipient, 200_000n)).toBe(true);

    expect(received(recipient)).toBe(1n);
    expect(receivedBroke(recipient)).toBe(1n);
    expect(donatedGold(recipient)).toBe(200_000n);
  });

  test("a donation to a rich recipient counts only as received", () => {
    recipient.addGold(2_000_000n);

    expect(donor.donateGold(recipient, 200_000n)).toBe(true);

    expect(received(recipient)).toBe(1n);
    expect(receivedBroke(recipient)).toBe(0n);
    expect(donatedGold(recipient)).toBe(200_000n);
  });

  test("a recipient one gold under the threshold is broke", () => {
    recipient.addGold(DONATION_BROKE_GOLD_THRESHOLD - 1n);

    expect(donor.donateGold(recipient, 200_000n)).toBe(true);

    expect(receivedBroke(recipient)).toBe(1n);
  });

  test("a recipient sitting exactly on the threshold is not broke", () => {
    recipient.addGold(DONATION_BROKE_GOLD_THRESHOLD);

    expect(donor.donateGold(recipient, 200_000n)).toBe(true);

    expect(received(recipient)).toBe(1n);
    expect(receivedBroke(recipient)).toBe(0n);
  });

  test("the balance is read before the donation lands", () => {
    // A donation big enough to lift the recipient clear of the threshold must
    // still count as broke; the reverse would make the stat unrecordable.
    expect(recipient.gold()).toBeLessThan(DONATION_BROKE_GOLD_THRESHOLD);

    expect(
      donor.donateGold(recipient, DONATION_BROKE_GOLD_THRESHOLD * 10n),
    ).toBe(true);

    expect(recipient.gold()).toBeGreaterThan(DONATION_BROKE_GOLD_THRESHOLD);
    expect(receivedBroke(recipient)).toBe(1n);
  });

  test("the sender records nothing", () => {
    donor.donateGold(recipient, 200_000n);

    expect(donations(donor)).toBeUndefined();
    expect(donatedGold(donor)).toBe(0n);
  });

  test("donations accumulate across the match", () => {
    donor.donateGold(recipient, 100_000n);
    recipient.addGold(5_000_000n);
    donor.donateGold(recipient, 300_000n);

    expect(received(recipient)).toBe(2n);
    expect(receivedBroke(recipient)).toBe(1n);
    expect(donatedGold(recipient)).toBe(400_000n);
  });

  test("a refused donation records nothing", () => {
    donor.removeGold(donor.gold());

    expect(donor.donateGold(recipient, 200_000n)).toBe(false);

    expect(donations(recipient)).toBeUndefined();
  });
});

describe("GoldDonationStats through DonateGoldExecution", () => {
  test("an allied donation is recorded on the recipient", async () => {
    game = await setup("ocean_and_land", { donateGold: true });
    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);
    donor = game.player("donor");
    recipient = game.player("recipient");

    game.addExecution(
      new SpawnExecution("game_id", donorInfo, game.ref(0, 10)),
      new SpawnExecution("game_id", recipientInfo, game.ref(0, 15)),
    );
    donor.createAllianceRequest(recipient)?.accept();
    game.executeNextTick();

    donor.addGold(500_000n);
    // A spawned player starts on 0 gold and accrues 100 a tick, so the
    // recipient is still far under the threshold when the donation lands.
    expect(recipient.gold()).toBeLessThan(DONATION_BROKE_GOLD_THRESHOLD);

    game.addExecution(new DonateGoldExecution(donor, "recipient", 400_000));
    game.executeNextTick();
    game.executeNextTick();

    expect(received(recipient)).toBe(1n);
    expect(receivedBroke(recipient)).toBe(1n);
    expect(donatedGold(recipient)).toBe(400_000n);
  });
});
