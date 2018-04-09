const enumHelper = require('../../utils/enumHelper');
const Battle = require('../utils/Battle');
const Monster = require('../utils/Monster');
const Item = require('../utils/Item');
const Inventory = require('../utils/Inventory');
const Spell = require('../utils/Spell');
const events = require('../data/events');
const { errorLog } = require('../../utils/logger');
const Map = require('../utils/Map');

class Event {

  constructor(Database, Helper) {
    this.Helper = Helper;
    this.Database = Database;
    this.Battle = new Battle(Helper);

    // Managers
    this.MonsterManager = new Monster(Helper);
    this.ItemManager = new Item(Helper);
    this.MapManager = new Map(Helper);
    this.SpellManager = new Spell(Helper);
    this.InventoryManager = new Inventory();

    // Events
    this.isBlizzardActive = false;
  }

  regenItem(selectedPlayer) {
    const regeneratedHelmet = this.ItemManager.regenerateItemByName(selectedPlayer.equipment.helmet, 'helmet');
    selectedPlayer.equipment.helmet = regeneratedHelmet;

    const regeneratedArmor = this.ItemManager.regenerateItemByName(selectedPlayer.equipment.armor, 'armor');
    selectedPlayer.equipment.armor = regeneratedArmor;

    const regeneratedWeapon = this.ItemManager.regenerateItemByName(selectedPlayer.equipment.weapon, 'weapon');
    selectedPlayer.equipment.weapon = regeneratedWeapon;
    return selectedPlayer;
  }

  // Move Events
  moveEvent(selectedPlayer, discordHook) {
    const mapObj = this.MapManager.moveToRandomMap(selectedPlayer);
    return events.movement.movePlayer(discordHook, selectedPlayer, mapObj);
  }

  attackEventPlayerVsPlayer(discordHook, selectedPlayer, onlinePlayers, multiplier) {
    return this.Database.getSameMapPlayers(selectedPlayer.map.name)
      .then(mappedPlayers => events.battle.pvpPreperation(selectedPlayer, mappedPlayers, onlinePlayers))
      .then(prepResults => prepResults.randomPlayer
        ? this.Battle.newSimulateBattle(selectedPlayer, prepResults.randomPlayer)
        : this.attackEventMob(discordHook, selectedPlayer, multiplier)
          .catch(err => errorLog.error(err)))
      .then(battleResults => battleResults.attacker
        ? events.battle.pvpResults(discordHook, battleResults)
        : battleResults)
      .then((battleResults) => {
        if (battleResults.result) {
          switch (battleResults.result) {
            case enumHelper.battle.outcomes.win:
              return Promise.all([
                events.battle.steal(discordHook, battleResults.updatedAttacker, battleResults.updatedDefender, this.InventoryManager)
              ])
                .then(promiseResults => this.Helper.checkHealth(this.MapManager, promiseResults[0].victimPlayer, promiseResults[0].stealingPlayer, discordHook)
                  .then(updatedVictim => this.Database.savePlayer(updatedVictim))
                  .then(() => this.Helper.checkExperience(promiseResults[0].stealingPlayer, discordHook, 'ToRemoveLater')));

            case enumHelper.battle.outcomes.fled:
              return this.Helper.checkExperience(battleResults.updatedDefender, discordHook, 'ToRemoveLater')
                .then(updatedDefender => this.Database.savePlayer(updatedDefender))
                .then(() => this.Helper.checkExperience(battleResults.updatedAttacker, discordHook, 'ToRemoveLater'));

            case enumHelper.battle.outcomes.lost:
              return Promise.all([
                events.battle.steal(discordHook, battleResults.updatedDefender, battleResults.updatedAttacker, this.InventoryManager)
              ])
                .then(promiseResults => this.Helper.checkExperience(promiseResults[0].stealingPlayer, discordHook, 'ToRemoveLater')
                  .then(updatedDefender => this.Database.savePlayer(updatedDefender))
                  .then(() => this.Helper.checkHealth(this.MapManager, promiseResults[0].victimPlayer, promiseResults[0].stealingPlayer, discordHook)));
          }
        }

        return battleResults;
      });
  }

  attackEventMob(discordHook, selectedPlayer, multiplier) {
    return this.MonsterManager.generateNewMonster(selectedPlayer)
      .then(mob => this.Battle.newSimulateBattle(selectedPlayer, mob))
      .then(results => events.battle.pveResults(discordHook, this.MapManager, results, multiplier))
      .then((battleResults) => {
        switch (battleResults.result) {
          case enumHelper.battle.outcomes.win:
            return Promise.all([
              events.battle.dropItem(discordHook, battleResults.updatedPlayer, battleResults.updatedMob, this.ItemManager, this.InventoryManager)
            ])
              .then(promiseResults => this.Helper.checkExperience(promiseResults[0], discordHook, 'ToRemoveLater'));

          case enumHelper.battle.outcomes.fled:
            return this.Helper.checkExperience(battleResults.updatedPlayer, discordHook, 'ToRemoveLater');

          case enumHelper.battle.outcomes.lost:
            return this.Helper.checkHealth(this.MapManager, battleResults.updatedPlayer, battleResults.updatedMob, discordHook);
        }
      });
  }

  // Item Events
  generateTownItemEvent(discordHook, selectedPlayer) {
    return this.ItemManager.generateItem(selectedPlayer)
      .then(item => events.town.item(discordHook, selectedPlayer, item, this.InventoryManager));
  }

  sellInTown(discordHook, selectedPlayer) {
    return events.town.sell(discordHook, selectedPlayer);
  }

  campEvent(discordHook, selectedPlayer) {
    return events.camp(discordHook, selectedPlayer);
  }

  // Luck Events
  generateGodsEvent(discordHook, selectedPlayer) {
    return new Promise((resolve) => {
      const luckEvent = this.Helper.randomBetween(1, 6);
      switch (luckEvent) {
        case 1:
          return events.luck.gods.hades(discordHook, selectedPlayer)
            .then(updatedPlayer => resolve(updatedPlayer));

        case 2:
          return events.luck.gods.zeus(discordHook, selectedPlayer)
            .then(updatedPlayer => this.Helper.checkHealth(this.MapManager, updatedPlayer, 'zeus', discordHook))
            .then(updatedPlayer => resolve(updatedPlayer));

        case 3:
          return events.luck.gods.aseco(discordHook, selectedPlayer)
            .then(updatedPlayer => resolve(updatedPlayer));

        case 4:
          return events.luck.gods.hermes(discordHook, selectedPlayer)
            .then(updatedPlayer => resolve(updatedPlayer));

        case 5:
          return events.luck.gods.athena(discordHook, selectedPlayer)
            .then(updatedPlayer => this.Helper.checkExperience(updatedPlayer, discordHook, 'removeLater'))
            .then(updatedPlayer => resolve(updatedPlayer));

        case 6:
          return this.SpellManager.generateSpell(selectedPlayer)
            .then(spell => events.luck.gods.eris(discordHook, selectedPlayer, spell))
            .then(updatedPlayer => resolve(updatedPlayer));
      }
    });
  }

  generateGoldEvent(discordHook, selectedPlayer, multiplier) {
    return events.luck.gold(discordHook, selectedPlayer, multiplier);
  }

  generateLuckItemEvent(discordHook, selectedPlayer) {
    return new Promise((resolve) => {
      const luckItemDice = this.Helper.randomBetween(0, 100);

      if (luckItemDice <= 15 + (selectedPlayer.stats.luk / 4)) {
        return this.SpellManager.generateSpell(selectedPlayer)
          .then(spell => events.luck.item.spell(discordHook, selectedPlayer, spell))
          .then(updatedPlayer => resolve(updatedPlayer));
      } else if (luckItemDice <= 30 + (selectedPlayer.stats.luk / 4)) {
        return this.ItemManager.generateItem(selectedPlayer)
          .then(item => events.luck.item.item(discordHook, selectedPlayer, item, this.InventoryManager))
          .then(updatedPlayer => resolve(updatedPlayer));
      }

      return resolve(selectedPlayer);
    });
  }

  generateGamblingEvent(discordHook, selectedPlayer) {
    return events.luck.gambling(discordHook, selectedPlayer);
  }

  /**
   * EVENT FUNCTIONS
   */
  blizzardSwitch(discordHook, blizzardSwitch) {
    switch (blizzardSwitch) {
      case 'on':
        if (this.isBlizzardActive) {
          return this.isBlizzardActive;
        }

        this.isBlizzardActive = true;
        this.Helper.sendMessage(discordHook, 'twitch', undefined, false, '@everyone\`\`\`python\n\'Heroes, sit near a fireplace at your home or take a beer with your friends at the inn. It\`s better to stay in cozy place as lots of heroes are in the midst of a violent snowstorm across the lands fighting mighty Yetis!\'\`\`\`');
        return this.isBlizzardActive;
      case 'off':
        if (!this.isBlizzardActive) {
          return this.isBlizzardActive;
        }

        this.isBlizzardActive = false;
        this.Helper.sendMessage(discordHook, 'twitch', undefined, false, '@everyone\`\`\`python\n\'It seems that blizzard has ended, you can safely travel to other realms. Do not walk away from the road as evil creatures may wait for you in dark forests!\'\`\`\`');
        return this.isBlizzardActive;
    }
  }

  chanceToCatchSnowflake(discordHook, selectedPlayer) {
    events.special.snowFlake(discordHook, selectedPlayer);
  }

  /**
   * GETTER SETTERS
   */
  get MonsterClass() {
    return this.MonsterManager;
  }

  get ItemClass() {
    return this.ItemManager;
  }

  get MapClass() {
    return this.MapManager;
  }

  get SpellClass() {
    return this.SpellManager;
  }

}
module.exports = Event;
