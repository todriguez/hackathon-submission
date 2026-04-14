/**
 * Bot persona definitions for the Docker swarm poker mesh.
 *
 * Four archetypes, cycling mod 4 by bot index:
 *   0 → nit       (tight-passive)
 *   1 → maniac    (loose-aggressive)
 *   2 → calculator (GTO-adjacent)
 *   3 → apex      (adaptive predator)
 *
 * Cross-references:
 *   entrypoint.docker-swarm.ts — reads BOT_PERSONA env
 *   Phase H1 PRD — DH1.3
 */

export interface BotPersona {
  name: string;
  description: string;
  aggression: number;      // 0.0-1.0
  volatility: number;      // 0.0-1.0
  bankrollRisk: number;    // 0.0-1.0
  foldThreshold: number;   // hand strength below which to fold
  raiseFrequency: number;  // 0.0-1.0
  bluffFrequency: number;  // 0.0-1.0
}

const PERSONAS: readonly BotPersona[] = [
  {
    name: 'nit',
    description: 'Tight-passive; only plays premium hands',
    aggression: 0.15,
    volatility: 0.1,
    bankrollRisk: 0.05,
    foldThreshold: 0.7,
    raiseFrequency: 0.2,
    bluffFrequency: 0.02,
  },
  {
    name: 'maniac',
    description: 'Loose-aggressive; plays many hands, raises often',
    aggression: 0.9,
    volatility: 0.85,
    bankrollRisk: 0.6,
    foldThreshold: 0.2,
    raiseFrequency: 0.7,
    bluffFrequency: 0.4,
  },
  {
    name: 'calculator',
    description: 'GTO-adjacent; pot-odds driven, low variance',
    aggression: 0.5,
    volatility: 0.3,
    bankrollRisk: 0.25,
    foldThreshold: 0.45,
    raiseFrequency: 0.45,
    bluffFrequency: 0.15,
  },
  {
    name: 'apex',
    description: 'Adaptive predator; exploits table dynamics',
    aggression: 0.65,
    volatility: 0.55,
    bankrollRisk: 0.4,
    foldThreshold: 0.35,
    raiseFrequency: 0.55,
    bluffFrequency: 0.25,
  },
] as const;

export function personaForIndex(index: number): BotPersona {
  return PERSONAS[index % PERSONAS.length];
}

export function personaNameForIndex(index: number): string {
  return PERSONAS[index % PERSONAS.length].name;
}

export function getPersonaByName(name: string): BotPersona | undefined {
  return PERSONAS.find(p => p.name === name);
}

export { PERSONAS };
