import { TerrainSearchMap } from './TerrainSearchMap';

export class CombatCalculator {
    public static resolveSkirmish(
        attacker: any, // Stub for UnitImpl
        defender: any, 
        terrainMap: TerrainSearchMap
    ): void {
        const hazardVector = terrainMap.getHazardVector(defender.x, defender.y);
        
        const physicalHazard = hazardVector[0];
        const cyberHazard = hazardVector[1];
        const politicalHazard = hazardVector[3];

        let defenderArmor = defender.baseArmor || 10;
        let defenderMorale = defender.morale || 1.0;

        // Physical Hazards destroy defensive entrenchment
        if (physicalHazard > 0.3) {
            defenderArmor *= (1.0 - (physicalHazard * 0.5)); 
        }

        // Political Hazards crush defending troop morale
        if (politicalHazard > 0.5) {
            defenderMorale = Math.max(0.1, defenderMorale - (politicalHazard * 0.1));
        }
        
        // Cyber Hazards cause attacker precision drop (Fog of War)
        let attackerFirepower = attacker.firepower || 20;
        if (cyberHazard > 0.6) {
            attackerFirepower *= 0.5; // 50% chance to miss/miscalculate
        }

        const damage = (attackerFirepower * attacker.morale || 1.0) / Math.max(1, defenderArmor);
        defender.hp -= damage; // Apply damage stub
    }
}