import { ClientID } from "../Schemas";
import { PlayerID, TerraNullius } from "./Game";

export class TerraNulliusImpl implements TerraNullius {
  constructor() {}
  smallID(): number {
    return 0;
  }
  clientID(): ClientID {
    return "TERRA_NULLIUS_CLIENT_ID";
  }

  id(): PlayerID {
    return null;
  }

  isPlayer(): false {
    return false as const;
  }
}
