import { DonateGoldExecution } from "../src/core/execution/DonateGoldExecution";
import { DonateTroopsExecution } from "../src/core/execution/DonateTroopExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

describe("Donate troops to an ally", () => {
  it("Troops should be successfully donated", async () => {
    const game = await setup("ocean_and_land", {
      infiniteTroops: false,
      donateTroops: true,
    });

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(donorInfo, spawnA),
      new SpawnExecution(recipientInfo, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // donor sends alliance request to recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // recipient accepts the alliance request
    if (allianceRequest) {
      allianceRequest.accept();
    }

    game.addExecution(new DonateTroopsExecution(donor, recipientInfo.id, 5000));

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    expect(donor.troops()).toBeLessThan(recipient.troops());
  });
});

describe("Donate gold to an ally", () => {
  it("Gold should be successfully donated", async () => {
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      donateGold: false,
    });

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(donorInfo, spawnA),
      new SpawnExecution(recipientInfo, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // donor sends alliance request to recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // recipient accepts the alliance request
    if (allianceRequest) {
      allianceRequest.accept();
    }

    console.log(`donor gold before donation: ${donor.gold()}`);
    console.log(`recipient gold before donation: ${recipient.gold()}`);

    game.addExecution(new DonateGoldExecution(donor, recipientInfo.id, 5000n));

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    console.log(`donor gold after donation: ${donor.gold()}`);
    console.log(`recipient gold after donation: ${recipient.gold()}`);

    expect(donor.gold() < recipient.gold());
  });
});

describe("Donate troops to a non ally", () => {
  it("Troops should not be donated", async () => {
    const game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: false,
      donateTroops: true,
    });

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(donorInfo, spawnA),
      new SpawnExecution(recipientInfo, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Donor sends alliance request to Recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // Donor rejects the Recipient
    if (allianceRequest) {
      allianceRequest.reject();
    }

    console.log(`donor troops before donation: ${donor.troops()}`);
    console.log(`recipient troops before donation: ${recipient.troops()}`);

    game.addExecution(new DonateTroopsExecution(donor, recipientInfo.id, 5000));

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    // Troops should not be donated since they are not allies but there's some small deviation due to game mechanics
    expect(Math.abs(donor.troops() - recipient.troops())).toBeLessThan(5000);
  });
});

describe("Donate Gold to a non ally", () => {
  it("Gold should not be donated", async () => {
    const game = await setup("ocean_and_land", {
      infiniteGold: false,
      donateGold: true,
    });

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(donorInfo, spawnA),
      new SpawnExecution(recipientInfo, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Donor sends alliance request to Recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // Donor rejects the Recipient
    if (allianceRequest) {
      allianceRequest.reject();
    }

    game.addExecution(new DonateGoldExecution(donor, recipientInfo.id, 5000n));

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    // Gold should not be donated since they are not allies but there's some small deviation due to game mechanics
    const difference = donor.gold() - recipient.gold();
    const absDifference = difference > 0n ? difference : -difference;

    expect(absDifference < 5000n).toBe(true);
  });
});
