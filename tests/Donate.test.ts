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
      await game.executeNextTick();
    }

    // donor sends alliance request to recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // recipient accepts the alliance request
    if (allianceRequest) {
      allianceRequest.accept();
    }

    // Ensure donor can actually donate the requested amount
    donor.addTroops(6000);
    const donorTroopsBefore = donor.troops();
    const recipientTroopsBefore = recipient.troops();
    game.addExecution(new DonateTroopsExecution(donor, recipientInfo.id, 5000));

    for (let i = 0; i < 5; i++) {
      await game.executeNextTick();
    }

    expect(donor.troops() < donorTroopsBefore).toBe(true);
    expect(recipient.troops() > recipientTroopsBefore).toBe(true);
  });
});

describe("Donate gold to an ally", () => {
  it("Gold should be successfully donated", async () => {
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
      await game.executeNextTick();
    }

    // donor sends alliance request to recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // recipient accepts the alliance request
    if (allianceRequest) {
      allianceRequest.accept();
    }
    await game.executeNextTick();

    // Ensure donor can actually donate the requested amount
    donor.addGold(6000n);
    const donorGoldBefore = donor.gold();
    const recipientGoldBefore = recipient.gold();
    game.addExecution(new DonateGoldExecution(donor, recipientInfo.id, 5000n));

    for (let i = 0; i < 5; i++) {
      await game.executeNextTick();
    }

    expect(donor.gold() < donorGoldBefore).toBe(true);
    expect(recipient.gold() > recipientGoldBefore).toBe(true);
  });
});

describe("Donate troops to a non ally", () => {
  it("Troops should not be donated", async () => {
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
      await game.executeNextTick();
    }

    // Donor sends alliance request to Recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // Donor rejects the Recipient
    if (allianceRequest) {
      allianceRequest.reject();
    }

    const donorTroopsBefore = donor.troops();
    const recipientTroopsBefore = recipient.troops();

    game.addExecution(new DonateTroopsExecution(donor, recipientInfo.id, 5000));
    await game.executeNextTick();

    // Troops should not be donated since they are not allies
    expect(donor.troops() >= donorTroopsBefore).toBe(true);
    expect(recipient.troops() >= recipientTroopsBefore).toBe(true);
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
      await game.executeNextTick();
    }

    // Donor sends alliance request to Recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // Donor rejects the Recipient
    if (allianceRequest) {
      allianceRequest.reject();
    }

    const donorGoldBefore = donor.gold();
    const recipientGoldBefore = donor.gold();

    game.addExecution(new DonateGoldExecution(donor, recipientInfo.id, 5000n));
    await game.executeNextTick();

    // Gold should not be donated since they are not allies
    expect(donor.gold() >= donorGoldBefore).toBe(true);
    expect(recipient.gold() >= recipientGoldBefore).toBe(true);
  });
});
