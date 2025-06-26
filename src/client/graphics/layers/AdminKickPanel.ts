import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

interface OnlinePlayer {
  clientID: string;
  username: string;
}

@customElement("admin-kick-panel")
export class AdminKickPanel extends LitElement implements Layer {
  public game: GameView;

  @state()
  private isVisible = false;

  @state()
  private isPanelOpen = false;

  @state()
  private selectedClientID = "";

  @state()
  private isKicking = false;

  @state()
  private onlinePlayers: OnlinePlayer[] = [];

  static styles = css`
    .admin-button {
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: rgba(239, 68, 68, 0.9);
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      z-index: 1000;
      backdrop-filter: blur(4px);
      transition: all 0.2s;
    }

    .admin-button:hover {
      background: rgba(239, 68, 68, 1);
      transform: translateY(-1px);
    }

    .kick-panel {
      position: fixed;
      bottom: 50px;
      right: 10px;
      background: rgba(17, 24, 39, 0.95);
      border: 1px solid rgba(75, 85, 99, 0.5);
      border-radius: 8px;
      padding: 16px;
      min-width: 280px;
      backdrop-filter: blur(8px);
      z-index: 1001;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
    }

    .panel-header {
      color: white;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .close-button {
      background: none;
      border: none;
      color: rgba(156, 163, 175, 1);
      cursor: pointer;
      font-size: 16px;
      padding: 0;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-button:hover {
      color: white;
    }

    .player-select {
      width: 100%;
      background: rgba(31, 41, 55, 0.8);
      border: 1px solid rgba(75, 85, 99, 0.5);
      border-radius: 6px;
      color: white;
      padding: 8px 12px;
      margin-bottom: 12px;
      font-size: 13px;
    }

    .player-select:focus {
      outline: none;
      border-color: rgba(239, 68, 68, 0.8);
    }

    .kick-button {
      width: 100%;
      background: rgba(239, 68, 68, 0.9);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
    }

    .kick-button:hover:not(:disabled) {
      background: rgba(239, 68, 68, 1);
    }

    .kick-button:disabled {
      background: rgba(107, 114, 128, 0.5);
      cursor: not-allowed;
    }

    .no-players {
      color: rgba(156, 163, 175, 1);
      font-size: 13px;
      text-align: center;
      padding: 8px 0;
    }
  `;

  createRenderRoot() {
    return this;
  }

  init() {
    // Check if user has admin privileges
    this.checkAdminStatus();
    this.updateOnlinePlayers();
  }

  tick() {
    // Update online players list periodically
    if (this.isVisible && this.isPanelOpen) {
      this.updateOnlinePlayers();
    }
  }

  private async checkAdminStatus() {
    try {
      
      const token = this.game?.authToken;
      if (!token) {
        this.isVisible = false;
        return;
      }

      // Check if user has admin roles
      const response = await fetch('/api/users/@me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const userData = await response.json();
        const roles = userData.player?.roles || [];
        
        // Check for admin roles (Admin, Mod, Head Mod, Support Staff, Fakeneo ik you are reading this and uhhh welp no not you)
        const adminRoles = [
          '1286738076386856991', // Admin
          '1338654590043820148', // Mod  
          '1357747869742010661', // Head Mod
          '1343759662545244296'  // Support Staff
        ];

        this.isVisible = roles.some(role => adminRoles.includes(role));
      }
    } catch (error) {
      console.warn('Failed to check admin status:', error);
      this.isVisible = false;
    }
    
    this.requestUpdate();
  }

  private updateOnlinePlayers() {
    // Get online players from the game state
    if (this.game?.gameState?.players) {
      this.onlinePlayers = Object.values(this.game.gameState.players)
        .filter(player => player.isConnected && !player.isBot)
        .map(player => ({
          clientID: player.clientID,
          username: player.username || 'Anonymous'
        }));
    } else {
      this.onlinePlayers = [];
    }
    this.requestUpdate();
  }

  private togglePanel() {
    this.isPanelOpen = !this.isPanelOpen;
    if (this.isPanelOpen) {
      this.updateOnlinePlayers();
      this.selectedClientID = "";
    }
    this.requestUpdate();
  }

  private closePanel() {
    this.isPanelOpen = false;
    this.selectedClientID = "";
    this.requestUpdate();
  }

  private onPlayerSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.selectedClientID = select.value;
  }

  private async kickPlayer() {
    if (!this.selectedClientID || this.isKicking) return;

    this.isKicking = true;
    this.requestUpdate();

    try {
      const gameID = this.game?.gameID;
      if (!gameID) {
        throw new Error('Game ID not available');
      }

      const token = this.game?.authToken;
      const response = await fetch(`/api/kick_player/${gameID}/${this.selectedClientID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          // Include admin header if available
          'X-Admin-Token': this.game?.adminToken || ''
        }
      });

      if (response.ok) {
        // Success - close panel and reset
        this.closePanel();
        console.log('Player kicked successfully');
      } else {
        const errorText = await response.text();
        console.error('Failed to kick player:', errorText);
        alert('Failed to kick player: ' + errorText);
      }
    } catch (error) {
      console.error('Error kicking player:', error);
      alert('Error kicking player: ' + error.message);
    } finally {
      this.isKicking = false;
      this.requestUpdate();
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <style>${AdminKickPanel.styles}</style>
      
      <button 
        class="admin-button" 
        @click=${this.togglePanel}
        @contextmenu=${(e) => e.preventDefault()}
      >
        👮 Admin
      </button>

      ${this.isPanelOpen ? html`
        <div class="kick-panel" @contextmenu=${(e) => e.preventDefault()}>
          <div class="panel-header">
            <span>Kick Player</span>
            <button class="close-button" @click=${this.closePanel}>✕</button>
          </div>

          ${this.onlinePlayers.length > 0 ? html`
            <select 
              class="player-select" 
              @change=${this.onPlayerSelect}
              .value=${this.selectedClientID}
            >
              <option value="">Select a player...</option>
              ${this.onlinePlayers.map(player => html`
                <option value=${player.clientID}>
                  ${player.username}
                </option>
              `)}
            </select>

            <button 
              class="kick-button"
              ?disabled=${!this.selectedClientID || this.isKicking}
              @click=${this.kickPlayer}
            >
              ${this.isKicking ? 'Kicking...' : 'Kick Player'}
            </button>
          ` : html`
            <div class="no-players">No players online</div>
          `}
        </div>
      ` : ''}
    `;
  }
}