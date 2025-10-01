/**
 * Glicko-2 Rating System Implementation
 * Based on: http://www.glicko.net/glicko/glicko2.pdf
 */

export interface Glicko2Rating {
  rating: number; // r
  ratingDeviation: number; // RD
  volatility: number; // σ
}

export interface Glicko2Match {
  opponentRating: number;
  opponentRD: number;
  score: number; // 1 = win, 0.5 = draw, 0 = loss
}

export class Glicko2 {
  // System constant tau - constrains volatility changes (typical: 0.3-1.2)
  private readonly tau: number;
  // Initial rating (Glicko-2 default: 1500)
  private readonly defaultRating: number;
  // Initial RD (Glicko-2 default: 350)
  private readonly defaultRD: number;
  // Initial volatility (Glicko-2 default: 0.06)
  private readonly defaultVolatility: number;

  constructor(config?: {
    tau?: number;
    defaultRating?: number;
    defaultRD?: number;
    defaultVolatility?: number;
  }) {
    this.tau = config?.tau ?? 0.5;
    this.defaultRating = config?.defaultRating ?? 1500;
    this.defaultRD = config?.defaultRD ?? 350;
    this.defaultVolatility = config?.defaultVolatility ?? 0.06;
  }

  /**
   * Create a new default rating
   */
  public createDefaultRating(): Glicko2Rating {
    return {
      rating: this.defaultRating,
      ratingDeviation: this.defaultRD,
      volatility: this.defaultVolatility,
    };
  }

  /**
   * Update a player's rating based on match results
   */
  public updateRating(
    currentRating: Glicko2Rating,
    matches: Glicko2Match[],
  ): Glicko2Rating {
    if (matches.length === 0) {
      // If no matches, just increase RD due to inactivity
      return {
        ...currentRating,
        ratingDeviation: this.applyRDDecay(currentRating.ratingDeviation),
      };
    }

    // Step 1: Convert ratings to Glicko-2 scale (μ, φ)
    const mu = this.ratingToMu(currentRating.rating);
    const phi = this.rdToPhi(currentRating.ratingDeviation);
    const sigma = currentRating.volatility;

    // Step 2: Convert opponent ratings to Glicko-2 scale
    const opponentData = matches.map((match) => ({
      mu: this.ratingToMu(match.opponentRating),
      phi: this.rdToPhi(match.opponentRD),
      score: match.score,
    }));

    // Step 3: Compute v (estimated variance)
    const v = this.computeVariance(mu, opponentData);

    // Step 4: Compute Δ (improvement in rating)
    const delta = this.computeDelta(mu, v, opponentData);

    // Step 5: Compute new volatility σ'
    const newSigma = this.computeNewVolatility(phi, v, delta, sigma);

    // Step 6: Update rating deviation φ* to new pre-rating period value
    const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);

    // Step 7: Update rating φ' and μ'
    const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const newMu = mu + newPhi * newPhi * this.computeGSum(mu, opponentData);

    // Step 8: Convert back to original scale
    return {
      rating: this.muToRating(newMu),
      ratingDeviation: this.phiToRD(newPhi),
      volatility: newSigma,
    };
  }

  /**
   * Apply RD decay due to inactivity (increases uncertainty)
   */
  private applyRDDecay(rd: number): number {
    const phi = this.rdToPhi(rd);
    const sigma = this.defaultVolatility;
    const newPhi = Math.sqrt(phi * phi + sigma * sigma);
    return Math.min(this.phiToRD(newPhi), this.defaultRD);
  }

  /**
   * Convert rating to Glicko-2 scale
   */
  private ratingToMu(rating: number): number {
    return (rating - 1500) / 173.7178;
  }

  /**
   * Convert Glicko-2 scale to rating
   */
  private muToRating(mu: number): number {
    return mu * 173.7178 + 1500;
  }

  /**
   * Convert RD to Glicko-2 scale
   */
  private rdToPhi(rd: number): number {
    return rd / 173.7178;
  }

  /**
   * Convert Glicko-2 scale to RD
   */
  private phiToRD(phi: number): number {
    return phi * 173.7178;
  }

  /**
   * g(φ) function - dampens opponent RD effect
   */
  private g(phi: number): number {
    return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
  }

  /**
   * E(μ, μj, φj) - expected score
   */
  private e(mu: number, muJ: number, phiJ: number): number {
    return 1 / (1 + Math.exp(-this.g(phiJ) * (mu - muJ)));
  }

  /**
   * Compute variance v
   */
  private computeVariance(
    mu: number,
    opponents: Array<{ mu: number; phi: number; score: number }>,
  ): number {
    let sum = 0;
    for (const opp of opponents) {
      const gPhi = this.g(opp.phi);
      const expected = this.e(mu, opp.mu, opp.phi);
      sum += gPhi * gPhi * expected * (1 - expected);
    }
    return 1 / sum;
  }

  /**
   * Compute delta Δ
   */
  private computeDelta(
    mu: number,
    v: number,
    opponents: Array<{ mu: number; phi: number; score: number }>,
  ): number {
    return v * this.computeGSum(mu, opponents);
  }

  /**
   * Compute sum of g(φj)(s - E)
   */
  private computeGSum(
    mu: number,
    opponents: Array<{ mu: number; phi: number; score: number }>,
  ): number {
    let sum = 0;
    for (const opp of opponents) {
      const gPhi = this.g(opp.phi);
      const expected = this.e(mu, opp.mu, opp.phi);
      sum += gPhi * (opp.score - expected);
    }
    return sum;
  }

  /**
   * Compute new volatility σ' using Illinois algorithm
   */
  private computeNewVolatility(
    phi: number,
    v: number,
    delta: number,
    sigma: number,
  ): number {
    const a = Math.log(sigma * sigma);
    const tau2 = this.tau * this.tau;
    const phi2 = phi * phi;
    const delta2 = delta * delta;

    // Function f(x)
    const f = (x: number): number => {
      const ex = Math.exp(x);
      const phi2ex = phi2 + v + ex;
      const term1 = (ex * (delta2 - phi2 - v - ex)) / (2 * phi2ex * phi2ex);
      const term2 = (x - a) / tau2;
      return term1 - term2;
    };

    // Initial search bounds
    let A = a;
    let B: number;
    if (delta2 > phi2 + v) {
      B = Math.log(delta2 - phi2 - v);
    } else {
      let k = 1;
      while (f(a - k * this.tau) < 0) {
        k++;
      }
      B = a - k * this.tau;
    }

    let fA = f(A);
    let fB = f(B);

    // Illinois algorithm to find root
    const epsilon = 0.000001;
    while (Math.abs(B - A) > epsilon) {
      const C = A + ((A - B) * fA) / (fB - fA);
      const fC = f(C);

      if (fC * fB < 0) {
        A = B;
        fA = fB;
      } else {
        fA = fA / 2;
      }

      B = C;
      fB = fC;
    }

    return Math.exp(A / 2);
  }

  /**
   * Calculate expected score for matchmaking purposes
   */
  public expectedScore(player: Glicko2Rating, opponent: Glicko2Rating): number {
    const muPlayer = this.ratingToMu(player.rating);
    const muOpponent = this.ratingToMu(opponent.rating);
    const phiOpponent = this.rdToPhi(opponent.ratingDeviation);
    return this.e(muPlayer, muOpponent, phiOpponent);
  }
}
